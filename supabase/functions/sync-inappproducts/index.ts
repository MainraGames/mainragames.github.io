// supabase/functions/sync-inappproducts/index.ts
// Syncs In-App Products (managed items & subscriptions) from Google Play Developer API
// GET /androidpublisher/v3/applications/{packageName}/inappproducts
// Stores catalog in public.game_inapp_products with public read RLS for web showcase.
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

function formatPriceMicros(priceMicros: string | null, currency = "USD") {
  if (!priceMicros) return "—";
  const micros = Number(priceMicros);
  if (isNaN(micros)) return "—";
  const amount = micros / 1000000;
  const locale = currency === "IDR" ? "id-ID" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency,
      maximumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(amount);
  } catch (_) {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function mapInAppProduct(raw: any, gameId: string) {
  if (!raw) return null;
  const sku = raw.sku || "";
  const status = raw.status || "active";
  const purchaseType = raw.purchaseType || "managedUser";
  const defaultLanguage = raw.defaultLanguage || "en-US";
  const listings = raw.listings || {};

  const listing = listings[defaultLanguage] || listings["en-US"] || listings["id-ID"] || Object.values(listings)[0] || {};
  const title = listing.title || sku;
  const description = listing.description || "";

  const defaultPrice = raw.defaultPrice || {};
  const priceMicros = defaultPrice.priceMicros || null;
  const currency = defaultPrice.currency || "USD";
  const formattedPrice = formatPriceMicros(priceMicros, currency);

  return {
    id: `${gameId}:${sku}`,
    game_id: gameId,
    sku: sku,
    status: status,
    purchase_type: purchaseType,
    title: title,
    description: description,
    price_micros: priceMicros,
    currency: currency,
    formatted_price: formattedPrice,
    prices: raw.prices || {},
    listings: listings,
    default_language: defaultLanguage,
    raw_payload: raw,
    synced_at: new Date().toISOString(),
  };
}

async function listInAppProducts(token: string, packageName: string) {
  const url = `${API}/applications/${packageName}/inappproducts?maxResults=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${packageName} error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const items = (data && data.inappproduct) || [];
  return items.map((item: any) => mapInAppProduct(item, packageName)).filter(Boolean);
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
  const onlyAppId = typeof body.appId === "string" && body.appId.trim() ? body.appId.trim() : "";

  try {
    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(400, { message: "GOOGLE_SERVICE_ACCOUNT_JSON secret is not configured in Supabase" });
    }

    const token = await accessToken(JSON.parse(saRaw));

    let packages: string[] = [];
    if (onlyAppId) {
      packages = [onlyAppId];
    } else {
      const { data: games } = await admin.from("games").select("appId,id");
      packages = [...new Set((games || []).map((g: any) => g.appId || g.id).filter(Boolean))] as string[];
    }

    if (packages.length === 0) {
      return json(200, { message: "No games found to check", count: 0 });
    }

    let allUpserted = 0;
    const warnings: string[] = [];

    for (const pkg of packages) {
      try {
        const rows = await listInAppProducts(token, pkg);
        if (rows.length > 0) {
          const { error } = await admin.from("game_inapp_products").upsert(rows, {
            onConflict: "id",
          });
          if (error) {
            console.error(`DB error for ${pkg}:`, error);
            warnings.push(`DB error for ${pkg}: ${error.message}`);
          } else {
            allUpserted += rows.length;
          }
        }
      } catch (err: any) {
        console.warn(`InAppProducts warning for ${pkg}:`, err.message || err);
        warnings.push(`${pkg}: ${err.message || err}`);
      }
    }

    return json(200, {
      message: `In-App Products sync completed. Synced ${allUpserted} items across ${packages.length} game(s).`,
      count: allUpserted,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    return json(500, { message: `Sync failed: ${err.message || err}` });
  }
});
