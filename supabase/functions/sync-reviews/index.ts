// supabase/functions/sync-reviews/index.ts
// Fetches Play Store reviews into game_reviews and pushes pending admin replies.
// Requires secret GOOGLE_SERVICE_ACCOUNT_JSON (service account with "Reply to reviews" permission).
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(sa: any) {
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der as unknown as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

async function accessToken(sa: any) {
  const jwt = await signJwt(sa);
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

function mapReview(r: any, appId: string) {
  const c = (r.comments && r.comments[0] && r.comments[0].userComment) || {};
  const lm = c.lastModified && (c.lastModified.seconds || c.lastModified.serverValue);
  return {
    review_id: r.reviewId,
    game_id: appId,
    author_name: (r.authorName && r.authorName.displayName) || c.authorName || "Anonymous",
    content: (c.text && c.text[0]) || "",
    star_rating: c.starRating || null,
    versionCode: c.appVersionName || null,
    device: c.deviceMetadata && c.deviceMetadata[0] ? c.deviceMetadata[0].deviceModel || null : null,
    review_timestamp: lm ? Number(lm) * 1000 : null,
    lang: c.reviewLanguage || null,
    source: "playstore",
  };
}

async function listReviews(token: string, packageName: string) {
  const out: any[] = [];
  let pageToken = "";
  do {
    const qs = new URLSearchParams({ packageName, maxResults: "50" });
    if (pageToken) qs.set("token", pageToken);
    const res = await fetch(`${API}/reviews?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`list ${packageName}: ${res.status} ${await res.text()}`);
      break;
    }
    const data = await res.json();
    out.push(...(data.reviews || []));
    pageToken = (data.tokenPagination && data.tokenPagination.nextPageToken) || "";
  } while (pageToken && out.length < 150);
  return out;
}

async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { admin: null, message: "Unauthorized" };
  const { data: adm } = await admin.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!adm) return { admin: null, message: "Not an admin" };
  return { admin, message: "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization,content-type,x-client-info",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  }

  const { admin, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
  if (!saRaw) {
  return json(200, {
    message:
      "GOOGLE_SERVICE_ACCOUNT_JSON secret is not set yet. Create a service account (Play Console → Users & permissions, grant 'Reply to reviews'), then: supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=...",
  });
  }

  try {
    const sa = JSON.parse(saRaw);
    const token = await accessToken(sa);

    let packages = ((Deno.env.get("PLAY_PACKAGE_NAMES") || "").split(",").map((s) => s.trim()).filter(Boolean));
    if (packages.length === 0) {
      const { data: games } = await admin.from("games").select("appId");
      packages = [...new Set((games || []).map((g: any) => g.appId).filter(Boolean))];
    }

    let fetched = 0;
    for (const pkg of packages) {
      const raw = await listReviews(token, pkg);
      if (raw.length === 0) continue;
      const rows = raw.map((r) => mapReview(r, pkg)).map((row) => {
        // Never overwrite admin reply fields from the scrape.
        const { reply_text, replySentAt, ...safe } = row as any;
        return safe;
      });
      const { error } = await admin.from("game_reviews").upsert(rows, {
        onConflict: "review_id",
        ignoreDuplicates: false,
      });
      if (error) return json(500, { message: "DB write failed: " + error.message });
      fetched += rows.length;
    }

    // Push pending replies (Play allows exactly one reply per review).
    const { data: pending } = await admin
      .from("game_reviews")
      .select("review_id,game_id,reply_text")
      .not("reply_text", "is", null)
      .is("replySentAt", null)
      .eq("source", "playstore")
      .limit(25);

    let posted = 0;
    const errors: string[] = [];
    for (const row of pending || []) {
      const res = await fetch(`${API}/applications/${row.game_id}/reviews/${row.review_id}:reply`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ replyText: row.reply_text }),
      });
      if (res.ok) {
        await admin.from("game_reviews").upsert([{ review_id: row.review_id, replySentAt: new Date().toISOString() }], { onConflict: "review_id" });
        posted++;
      } else {
        errors.push(`${row.review_id}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
      }
    }

    const parts = [`Fetched ${fetched} reviews`];
    if (pending?.length) parts.push(`posted ${posted}/${pending.length} replies`);
    if (errors.length) parts.push(`errors: ${errors.join(" | ")}`);
    return json(200, { message: parts.join(", ") });
  } catch (err) {
    return json(500, { message: String((err as Error).message || err) });
  }
});
