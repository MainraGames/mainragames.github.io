// supabase/functions/sync-reviews/index.ts
// Pulls Play Store reviews into public.game_reviews and pushes pending admin replies.
//
// Two modes:
//   1. Google Play Developer API — used when GOOGLE_SERVICE_ACCOUNT_JSON is set.
//      Full fidelity: paginated reviews, device/version metadata, and reply posting.
//   2. Public review scrape (google-play-scraper) — fallback when the service account
//      is missing, so reviews still reach the dashboard. Read-only: replies saved in
//      the dashboard stay queued and are posted on the next Developer-API run.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import gplayMod from "npm:google-play-scraper@10.1.3";

const gplay: any = (gplayMod as any).default ?? gplayMod;
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCRAPE_LOCALES: Array<[string, string]> = [
  ["id", "id"],
  ["en", "us"],
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function b64url(buf: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode the service-account private key: extract base64 DER body. */
function decodePrivateKey(pem: string): Uint8Array {
  const clean = pem.replace(/-----BEGIN[^-]+-----/g, "").replace(/-----END[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function signJwt(sa: any) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    decodePrivateKey(sa.private_key) as unknown as ArrayBuffer,
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

/** Google Play Developer API review -> DB row. */
function mapApiReview(r: any, appId: string) {
  const comment = (r.comments && r.comments[0]) || {};
  const c = comment.userComment || {};
  const reply = comment.developerComment || {};
  const lm = c.lastModified && (c.lastModified.seconds || c.lastModified.serverValue);
  const row: any = {
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
  if (reply.text) {
    row.reply_text = reply.text[0] || reply.text;
    row.replySentAt = new Date().toISOString();
  }
  return row;
}

/** Public scrape review -> DB row. */
function mapScrapedReview(r: any, appId: string, lang: string) {
  const ts = r.date ? Date.parse(r.date) : NaN;
  const row: any = {
    review_id: r.id,
    game_id: appId,
    author_name: r.userName || "Anonymous",
    content: r.text || "",
    star_rating: typeof r.score === "number" ? r.score : null,
    versionCode: r.version || null,
    device: null,
    review_timestamp: Number.isFinite(ts) ? ts : null,
    lang,
    source: "playstore",
  };
  // A reply already published on Google must not be re-posted by the queue.
  if (r.replyText) {
    row.reply_text = r.replyText;
    row.replySentAt = r.replyDate ? new Date(r.replyDate).toISOString() : new Date().toISOString();
  }
  return row;
}

async function listApiReviews(token: string, packageName: string) {
  const out: any[] = [];
  let pageToken = "";
  do {
    const qs = new URLSearchParams({ maxResults: "50" });
    if (pageToken) qs.set("token", pageToken);
    const res = await fetch(`${API}/applications/${packageName}/reviews?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
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

async function listScrapedReviews(packageName: string) {
  const seen = new Map<string, any>();
  for (const [lang, country] of SCRAPE_LOCALES) {
    try {
      const res = await gplay.reviews({
        appId: packageName,
        lang,
        country,
        sort: gplay.sort ? gplay.sort.NEWEST : 2,
        num: 120,
      });
      for (const r of res.data || []) {
        if (r && r.id && !seen.has(r.id)) seen.set(r.id, mapScrapedReview(r, packageName, lang));
      }
    } catch (err) {
      console.error(`scrape ${packageName} (${lang}-${country}): ${(err as Error).message}`);
    }
  }
  return [...seen.values()];
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
      headers: CORS_HEADERS,
    });
  }

  const { admin, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  const body = await req.json().catch(() => ({}));
  const onlyAppId = typeof body.appId === "string" && body.appId.trim() ? body.appId.trim() : "";

  // Direct single-reply post/update directly to Google Play:
  if (body.action === "reply") {
    const { reviewId, appId, replyText } = body;
    if (!reviewId || !appId || !replyText) {
      return json(400, { message: "reviewId, appId, and replyText are required" });
    }
    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(400, { message: "Google service account key is not configured" });
    }
    const token = await accessToken(JSON.parse(saRaw));
    const res = await fetch(`${API}/applications/${appId}/reviews/${reviewId}:reply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyText }),
    });
    if (!res.ok) {
      const errTxt = await res.text();
      return json(res.status, { message: `Google Play API error: ${errTxt}` });
    }
    const sentAt = new Date().toISOString();
    await admin.from("game_reviews").upsert([{
      review_id: reviewId,
      game_id: appId,
      reply_text: replyText,
      reply_timestamp: Date.now(),
      replySentAt: sentAt,
    }], { onConflict: "review_id" });

    return json(200, { message: "Reply posted to Google Play Store successfully!", replySentAt: sentAt });
  }

  try {
    let packages: string[] = [];
    if (onlyAppId) {
      packages = [onlyAppId];
    } else {
      packages = (Deno.env.get("PLAY_PACKAGE_NAMES") || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      if (packages.length === 0) {
        const { data: games } = await admin.from("games").select("appId");
        packages = [...new Set((games || []).map((g: any) => g.appId).filter(Boolean))] as string[];
      }
    }
    if (packages.length === 0) return json(200, { message: "No games to sync yet", mode: "none" });

    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    const mode = saRaw ? "developer-api" : "scrape";
    let token = "";
    if (saRaw) token = await accessToken(JSON.parse(saRaw));

    let fetched = 0;
    for (const pkg of packages) {
      const rowsMap = new Map();

      // 1. Fetch from official Google Play API
      if (mode === "developer-api") {
        try {
          const apiRows = await listApiReviews(token, pkg);
          for (const r of apiRows) {
            const mapped = mapApiReview(r, pkg);
            if (mapped && mapped.review_id) rowsMap.set(mapped.review_id, mapped);
          }
        } catch (err) {
          console.error(`listApiReviews error for ${pkg}:`, err);
        }
      }

      // 2. Fetch from scraper (covers public reviews, multiple locales, and apps with public ratings)
      try {
        const scrapedRows = await listScrapedReviews(pkg);
        for (const r of scrapedRows) {
          if (r && r.review_id && !rowsMap.has(r.review_id)) {
            rowsMap.set(r.review_id, r);
          }
        }
      } catch (err) {
        console.error(`listScrapedReviews error for ${pkg}:`, err);
      }

      let rows = Array.from(rowsMap.values());
      if (rows.length === 0) continue;

      // Only write reply fields when Google actually has a reply; otherwise leave
      // any draft the admin saved in the dashboard untouched.
      rows = rows.map((row) => {
        if (row.reply_text) return row;
        const copy = { ...row };
        delete copy.reply_text;
        delete copy.replySentAt;
        return copy;
      });
      const { error } = await admin.from("game_reviews").upsert(rows, {
        onConflict: "review_id",
        ignoreDuplicates: false,
      });
      if (error) return json(500, { message: "DB write failed: " + error.message });
      fetched += rows.length;
    }

    const parts = [`Fetched ${fetched} reviews (${mode})`];
    let posted = 0;

    if (mode === "developer-api") {
      // Play allows exactly one reply per review; only unsent drafts are pushed.
      const { data: pending } = await admin
        .from("game_reviews")
        .select("review_id,game_id,reply_text")
        .not("reply_text", "is", null)
        .is("replySentAt", null)
        .eq("source", "playstore")
        .limit(25);

      const errors: string[] = [];
      for (const row of pending || []) {
        const res = await fetch(`${API}/applications/${row.game_id}/reviews/${row.review_id}:reply`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ replyText: row.reply_text }),
        });
        if (res.ok) {
          await admin.from("game_reviews")
            .upsert([{ review_id: row.review_id, replySentAt: new Date().toISOString() }], { onConflict: "review_id" });
          posted++;
        } else {
          errors.push(`${row.review_id}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
        }
      }
      if (pending?.length) parts.push(`posted ${posted}/${pending.length} replies`);
      if (errors.length) parts.push(`errors: ${errors.join(" | ")}`);
    } else {
      const { count } = await admin
        .from("game_reviews")
        .select("review_id", { count: "exact", head: true })
        .not("reply_text", "is", null)
        .is("replySentAt", null);
      if (count) {
        parts.push(`${count} reply draft(s) queued — set GOOGLE_SERVICE_ACCOUNT_JSON to publish them to Google Play`);
      }
    }

    return json(200, { message: parts.join(", "), mode, fetched, posted });
  } catch (err) {
    return json(500, { message: String((err as Error).message || err) });
  }
});
