// supabase/functions/sync-store-listings/index.ts
// 2-Way Google Play Store Listings & Assets API (edits.listings & edits.images)
// 1. Pulls multi-language listings (title, shortDescription, fullDescription, video) -> public.game_store_listings & games
// 2. Pushes admin updates from Web -> Google Play Store listing via edits.listings:update & edits:commit
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";

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

async function createEdit(token: string, packageName: string) {
  const res = await fetch(`${API}/applications/${packageName}/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Create edit failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.id as string;
}

async function commitEdit(token: string, packageName: string, editId: string) {
  const res = await fetch(`${API}/applications/${packageName}/edits/${editId}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Commit edit failed (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function deleteEdit(token: string, packageName: string, editId: string) {
  try {
    await fetch(`${API}/applications/${packageName}/edits/${editId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_) {}
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
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const { admin, message } = await requireAdmin(req);
  if (!admin) return json(401, { message });

  const body = await req.json().catch(() => ({}));
  const action = body.action || "pull"; // "pull" or "push"

  try {
    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(200, {
        success: false,
        error: true,
        message: "GOOGLE_SERVICE_ACCOUNT_JSON secret belum dikonfigurasi di Supabase Secrets."
      });
    }
    const token = await accessToken(JSON.parse(saRaw));

    // PUSH ACTION: Update a store listing on Google Play Console
    if (action === "push") {
      const { appId, language, title, shortDescription, fullDescription, video } = body;
      if (!appId || !language) {
        return json(400, { message: "appId and language are required for push" });
      }

      // Validate Google Play Store character limits
      if (title && title.length > 30) {
        return json(400, { message: `Title exceeds 30 characters (current: ${title.length})` });
      }
      if (shortDescription && shortDescription.length > 80) {
        return json(400, { message: `Short description exceeds 80 characters (current: ${shortDescription.length})` });
      }
      if (fullDescription && fullDescription.length > 4000) {
        return json(400, { message: `Full description exceeds 4000 characters (current: ${fullDescription.length})` });
      }

      const editId = await createEdit(token, appId);
      try {
        const putUrl = `${API}/applications/${appId}/edits/${editId}/listings/${language}`;
        const updateRes = await fetch(putUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            language,
            title: title || "",
            shortDescription: shortDescription || "",
            fullDescription: fullDescription || "",
            video: video || undefined,
          }),
        });

        if (!updateRes.ok) {
          const errText = await updateRes.text();
          throw new Error(`Listing update failed (${updateRes.status}): ${errText}`);
        }

        // Commit the changes to Google Play Store
        await commitEdit(token, appId, editId);

        // Update local Supabase database
        await admin.from("game_store_listings").upsert([{
          id: `${appId}:${language}`,
          game_id: appId,
          language,
          title: title || "",
          short_description: shortDescription || "",
          full_description: fullDescription || "",
          video: video || null,
          synced_at: new Date().toISOString(),
        }], { onConflict: "id" });

        return json(200, { message: `Successfully pushed listing (${language}) to Google Play Console!` });
      } catch (err: any) {
        await deleteEdit(token, appId, editId);
        throw err;
      }
    }

    // PULL ACTION: Fetch all listings from Google Play Console
    const onlyAppId = typeof body.appId === "string" && body.appId.trim() ? body.appId.trim() : "";
    let packages: string[] = [];
    if (onlyAppId) {
      packages = [onlyAppId];
    } else {
      const { data: games } = await admin.from("games").select("appId,id");
      packages = [...new Set((games || []).map((g: any) => g.appId || g.id).filter(Boolean))] as string[];
    }

    let totalListings = 0;
    const warnings: string[] = [];

    for (const pkg of packages) {
      let editId = "";
      try {
        editId = await createEdit(token, pkg);
        const listUrl = `${API}/applications/${pkg}/edits/${editId}/listings`;
        const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          const listings = data.listings || [];
          if (listings.length > 0) {
            const rows = listings.map((l: any) => ({
              id: `${pkg}:${l.language}`,
              game_id: pkg,
              language: l.language,
              title: l.title || "",
              short_description: l.shortDescription || "",
              full_description: l.fullDescription || "",
              video: l.video || null,
              synced_at: new Date().toISOString(),
            }));

            await admin.from("game_store_listings").upsert(rows, { onConflict: "id" });
            totalListings += rows.length;

            // Also merge primary listing into public.games for instant showcase
            const primary = rows.find((r: any) => r.language === "id-ID") ||
                            rows.find((r: any) => r.language.startsWith("id")) ||
                            rows.find((r: any) => r.language === "en-US") ||
                            rows[0];

            if (primary) {
              const storeListingsMap: Record<string, any> = {};
              rows.forEach((r: any) => {
                storeListingsMap[r.language] = {
                  title: r.title,
                  shortDescription: r.short_description,
                  fullDescription: r.full_description,
                  video: r.video,
                };
              });

              await admin.from("games").update({
                short_description: primary.short_description,
                video_url: primary.video,
                store_listings: storeListingsMap,
              }).eq("id", pkg);
            }
          }
        }
      } catch (err: any) {
        console.warn(`Error pulling listings for ${pkg}:`, err.message || err);
        warnings.push(`${pkg}: ${err.message || err}`);
      } finally {
        if (editId) await deleteEdit(token, pkg, editId);
      }
    }

    return json(200, {
      message: `Pulled ${totalListings} multi-language store listings across ${packages.length} game(s).`,
      count: totalListings,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    return json(500, { message: `Store listing operation failed: ${err.message || err}` });
  }
});
