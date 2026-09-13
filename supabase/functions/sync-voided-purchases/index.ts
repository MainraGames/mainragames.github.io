// supabase/functions/sync-voided-purchases/index.ts
// Syncs voided purchases (refunds, cancellations, fraud, chargebacks) from Google Play Developer API
// GET /androidpublisher/v3/applications/{packageName}/purchases/voidedpurchases
// Stores records in public.game_voided_purchases.
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

const VOIDED_REASONS: Record<number, string> = {
  0: "Other",
  1: "Remorse (User Regret)",
  2: "Not Received",
  3: "Defective",
  4: "Accidental Purchase",
  5: "Fraud",
  6: "Friendly Fraud",
  7: "Chargeback",
  8: "Unacknowledged Purchase",
};

const VOIDED_SOURCES: Record<number, string> = {
  0: "User",
  1: "Developer",
  2: "Google",
};

function mapVoidedPurchase(raw: any, gameId: string) {
  if (!raw) return null;
  const orderId = raw.orderId || raw.order_id || "";
  const purchaseToken = raw.purchaseToken || raw.purchase_token || "";
  const purchaseTime = raw.purchaseTimeMillis ? Number(raw.purchaseTimeMillis) : null;
  const voidedTime = raw.voidedTimeMillis ? Number(raw.voidedTimeMillis) : null;
  const voidedSource = raw.voidedSource != null ? Number(raw.voidedSource) : null;
  const voidedReason = raw.voidedReason != null ? Number(raw.voidedReason) : null;
  const voidedQuantity = raw.voidedQuantity != null ? Number(raw.voidedQuantity) : 1;

  const isFraudOrChargeback = voidedReason === 5 || voidedReason === 6 || voidedReason === 7;

  return {
    order_id: orderId,
    game_id: gameId,
    purchase_token: purchaseToken,
    purchase_time_millis: purchaseTime,
    voided_time_millis: voidedTime,
    voided_source: voidedSource,
    voided_source_label: VOIDED_SOURCES[voidedSource ?? -1] || (voidedSource != null ? `Unknown (${voidedSource})` : "Unknown"),
    voided_reason: voidedReason,
    voided_reason_label: VOIDED_REASONS[voidedReason ?? -1] || (voidedReason != null ? `Unknown (${voidedReason})` : "Unknown"),
    voided_quantity: voidedQuantity,
    is_fraud_or_chargeback: isFraudOrChargeback,
    raw_payload: raw,
    synced_at: new Date().toISOString(),
  };
}

async function listVoidedPurchasesForPackage(token: string, packageName: string) {
  const url = `${API}/applications/${packageName}/purchases/voidedpurchases?maxResults=1000&type=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    // 403 usually means Financial Reports permission is not enabled in Service Account, or app has no IAP configured
    throw new Error(`Google API ${packageName} error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const list = (data && data.voidedPurchases) || [];
  return list.map((item: any) => mapVoidedPurchase(item, packageName)).filter(Boolean);
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
    // Financial Reports permission is required for voided purchases API
    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(200, {
        success: false,
        error: true,
        message: "GOOGLE_SERVICE_ACCOUNT_JSON secret belum dikonfigurasi di Supabase Secrets.",
        detail: "Silakan set GOOGLE_SERVICE_ACCOUNT_JSON di Supabase Dashboard / CLI.",
      });
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
      return json(200, { message: "No games to check", totalVoided: 0 });
    }

    let allUpserted = 0;
    const warnings: string[] = [];

    for (const pkg of packages) {
      try {
        const rows = await listVoidedPurchasesForPackage(token, pkg);
        if (rows.length > 0) {
          const { error } = await admin.from("game_voided_purchases").upsert(rows, {
            onConflict: "order_id",
          });
          if (error) {
            console.error(`DB upsert failed for ${pkg}:`, error);
            warnings.push(`DB error for ${pkg}: ${error.message}`);
          } else {
            allUpserted += rows.length;
          }
        }
      } catch (err: any) {
        console.warn(`Voided purchases warning for ${pkg}:`, err.message || err);
        warnings.push(`${pkg}: ${err.message || err}`);
      }
    }

    return json(200, {
      message: `Voided purchases sync completed. Synced ${allUpserted} records.`,
      count: allUpserted,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    return json(500, { message: `Sync failed: ${err.message || err}` });
  }
});
