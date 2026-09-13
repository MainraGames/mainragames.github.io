// supabase/functions/verify-purchase/index.ts
// Server-side verification & acknowledgment for Google Play In-App Purchases
// API: androidpublisher v3 purchases.products.get and purchases.products.acknowledge
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

/** Constant-time string comparison (hash first so lengths never leak). */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(200, {
        success: false,
        error: true,
        message: "GOOGLE_SERVICE_ACCOUNT_JSON is not configured in Supabase Secrets."
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    let body: any = {};
    try { body = await req.json(); } catch (_) {}

    const { packageName, productId, purchaseToken, autoAcknowledge } = body;
    if (!packageName || !productId || !purchaseToken) {
      return json(400, {
        success: false,
        error: true,
        message: "packageName, productId, and purchaseToken are required."
      });
    }

    // Fail closed: with no configured secret this endpoint would accept
    // unauthenticated traffic and let anyone burn the Google Play API quota.
    const configuredSecret = (Deno.env.get("IAP_VERIFY_SECRET") || "").trim();
    if (!configuredSecret) {
      console.error("IAP_VERIFY_SECRET is not configured — refusing to verify purchases.");
      return json(503, {
        success: false,
        error: true,
        message: "Purchase verification is temporarily unavailable."
      });
    }

    const presentedSecret = (req.headers.get("x-app-signature") || body.appSignature || "").trim();
    if (!presentedSecret || !(await timingSafeEqual(presentedSecret, configuredSecret))) {
      return json(401, {
        success: false,
        error: true,
        message: "Unauthorized: invalid or missing x-app-signature."
      });
    }

    // Idempotency: a token already recorded as VALID and acknowledged is
    // answered from the database, so replays cannot re-spend Google Play quota.
    const { data: existing } = await adminClient
      .from("game_purchase_verifications")
      .select("status, is_acknowledged, order_id")
      .eq("purchase_token", purchaseToken)
      .maybeSingle();

    if (existing && existing.status === "VALID" && existing.is_acknowledged) {
      return json(200, {
        success: true,
        valid: true,
        status: "VALID",
        isAcknowledged: true,
        orderId: existing.order_id,
        alreadyVerified: true
      });
    }

    const sa = JSON.parse(saRaw);
    const token = await accessToken(sa);

    // 1. Verify purchase with Google Play API
    const getUrl = `${API}/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}`;
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!getRes.ok) {
      const errBody = await getRes.text();
      console.error(`Google Play purchase verification failed (${getRes.status}): ${errBody}`);
      return json(200, {
        success: false,
        error: true,
        status: "INVALID",
        message: "Google Play rejected this purchase token."
      });
    }

    const purchase = await getRes.json();
    const isPurchased = purchase.purchaseState === 0;
    let isAcknowledged = purchase.acknowledgementState === 1;

    let acknowledgeResult = null;
    // 2. Acknowledge if requested and not yet acknowledged
    if (isPurchased && !isAcknowledged && autoAcknowledge) {
      const ackUrl = `${API}/applications/${packageName}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;
      const ackRes = await fetch(ackUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ developerPayload: "verified_via_mainra_backend" })
      });

      if (ackRes.ok) {
        isAcknowledged = true;
        acknowledgeResult = "ACKNOWLEDGED_SUCCESSFULLY";
      } else {
        console.error(`Acknowledge failed (${ackRes.status}): ${await ackRes.text()}`);
        acknowledgeResult = "ACKNOWLEDGE_FAILED";
      }
    }

    // 3. Record verified transaction in database
    const dbRow = {
      purchase_token: purchaseToken,
      game_id: packageName,
      product_id: productId,
      order_id: purchase.orderId || null,
      status: isPurchased ? "VALID" : (purchase.purchaseState === 1 ? "CANCELED" : "PENDING"),
      is_acknowledged: isAcknowledged,
      purchase_time_millis: purchase.purchaseTimeMillis ? parseInt(purchase.purchaseTimeMillis, 10) : null,
      consumption_state: purchase.consumptionState === 1 ? "CONSUMED" : "UNCONSUMED",
      verified_at: new Date().toISOString(),
      acknowledged_at: isAcknowledged ? new Date().toISOString() : null,
    };

    const { error: upsertErr } = await adminClient
      .from("game_purchase_verifications")
      .upsert([dbRow], { onConflict: "purchase_token" });

    if (upsertErr) {
      console.error("Failed to record purchase verification:", upsertErr.message);
      return json(500, {
        success: false,
        error: true,
        message: "Gagal mencatat verifikasi pembelian."
      });
    }

    return json(200, {
      success: true,
      valid: isPurchased,
      status: dbRow.status,
      isAcknowledged,
      orderId: purchase.orderId,
      purchaseTimeMillis: purchase.purchaseTimeMillis,
      acknowledgeResult
    });
  } catch (err: any) {
    console.error("Purchase verification error:", err?.message || err);
    return json(200, { success: false, error: true, message: "Purchase verification failed." });
  }
});
