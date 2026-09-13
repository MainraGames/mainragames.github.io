// supabase/functions/sync-conversions/index.ts
// Syncs Store Listing Conversion & Acquisition Funnel Metrics
// from Google Play Developer Reporting API (playdeveloperreporting.googleapis.com)
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const REPORTING_API = "https://playdeveloperreporting.googleapis.com/v1beta1";

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
    scope: "https://www.googleapis.com/auth/playdeveloperreporting",
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
  return { admin, user: data.user, message: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { admin, user, message } = await requireAdmin(req);
    if (!admin) return json(401, { message });

    const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
    if (!saRaw) {
      return json(200, {
        success: false,
        error: true,
        message: "GOOGLE_SERVICE_ACCOUNT_JSON is not configured in Supabase Secrets."
      });
    }

    const sa = JSON.parse(saRaw);
    const token = await accessToken(sa);

    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const targetAppId = (body.appId || "").trim();

    let packages: string[] = [];
    if (targetAppId) {
      packages = [targetAppId];
    } else {
      const { data: games } = await admin.from("games").select("appId,id");
      packages = [...new Set((games || []).map((g: any) => g.appId || g.id).filter(Boolean))] as string[];
    }

    let syncedCount = 0;
    const warnings: string[] = [];

    for (const pkg of packages) {
      try {
        const queryUrl = `${REPORTING_API}/apps/${pkg}/conversionRateMetricSet:query`;
        const res = await fetch(queryUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            timelineSpec: {
              aggregationPeriod: "DAY",
              startTime: {
                year: new Date(Date.now() - 14 * 86400000).getUTCFullYear(),
                month: new Date(Date.now() - 14 * 86400000).getUTCMonth() + 1,
                day: new Date(Date.now() - 14 * 86400000).getUTCDate(),
              },
            },
            dimensions: ["countryCode", "trafficSource"],
            metrics: ["storeListingVisitors", "storeListingAcquisitions"],
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          warnings.push(`${pkg}: HTTP ${res.status} - ${errBody.slice(0, 100)}`);
          continue;
        }

        const data = await res.json();
        const rows = data.rows || [];

        let totalVisitors = 0;
        let totalAcquisitions = 0;
        const dbRows = [];

        for (const r of rows) {
          const dims = r.dimensions || [];
          const metrics = r.metrics || [];

          const countryDim = dims.find((d: any) => d.dimension === "countryCode");
          const sourceDim = dims.find((d: any) => d.dimension === "trafficSource");

          const country = countryDim ? countryDim.stringValue : "GLOBAL";
          const source = sourceDim ? sourceDim.stringValue : "ALL";

          const visitorsMetric = metrics.find((m: any) => m.metric === "storeListingVisitors");
          const acqMetric = metrics.find((m: any) => m.metric === "storeListingAcquisitions");

          const visitors = visitorsMetric?.decimalValue?.value ? parseInt(visitorsMetric.decimalValue.value, 10) : 0;
          const acquisitions = acqMetric?.decimalValue?.value ? parseInt(acqMetric.decimalValue.value, 10) : 0;
          const rate = visitors > 0 ? parseFloat(((acquisitions / visitors) * 100).toFixed(1)) : 0.0;

          if (country === "GLOBAL" && source === "ALL") {
            totalVisitors = visitors;
            totalAcquisitions = acquisitions;
          } else if (country !== "GLOBAL" && totalVisitors === 0) {
            totalVisitors += visitors;
            totalAcquisitions += acquisitions;
          }

          const metricDate = new Date().toISOString().split("T")[0];
          dbRows.push({
            id: `${pkg}:${metricDate}:${country}:${source}`,
            game_id: pkg,
            metric_date: metricDate,
            country,
            traffic_source: source,
            visitors,
            acquisitions,
            conversion_rate: rate,
            synced_at: new Date().toISOString(),
          });
        }

        const globalRate = totalVisitors > 0 ? parseFloat(((totalAcquisitions / totalVisitors) * 100).toFixed(1)) : 0.0;

        // Upsert into detailed table
        if (dbRows.length > 0) {
          await admin.from("game_conversion_metrics").upsert(dbRows, { onConflict: "id" });
        }

        // Update games table snapshot
        await admin.from("games").update({
          conversion_visitors: totalVisitors,
          conversion_acquisitions: totalAcquisitions,
          conversion_rate: globalRate,
          conversion_synced_at: new Date().toISOString(),
        }).eq("id", pkg);

        syncedCount++;
      } catch (err: any) {
        warnings.push(`${pkg}: ${err.message || err}`);
      }
    }

    return json(200, {
      success: true,
      message: `Berhasil menyinkronkan metrik konversi untuk ${syncedCount} game!`,
      syncedCount,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    return json(200, { success: false, error: true, message: `Conversion sync error: ${err.message}` });
  }
});
