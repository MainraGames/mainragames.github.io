// supabase/functions/sync-vitals/index.ts
// Syncs Android Vitals (Crash Rate, ANR Rate, Bad Behavior Threshold checks)
// from Google Play Developer Reporting API (playdeveloperreporting.googleapis.com)
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const REPORTING_API = "https://playdeveloperreporting.googleapis.com/v1beta1";
const CRASH_RATE_BAD_BEHAVIOR_THRESHOLD = 0.0109; // 1.09%
const ANR_RATE_BAD_BEHAVIOR_THRESHOLD = 0.0047;   // 0.47%
const CRASH_RATE_WARNING_THRESHOLD = 0.0085;      // 0.85%
const ANR_RATE_WARNING_THRESHOLD = 0.0037;        // 0.37%

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
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token as string;
}

function assessVitals(crashRate: number, anrRate: number) {
  const crash = Number(crashRate || 0);
  const anr = Number(anrRate || 0);

  const crashExceeded = crash >= CRASH_RATE_BAD_BEHAVIOR_THRESHOLD;
  const anrExceeded = anr >= ANR_RATE_BAD_BEHAVIOR_THRESHOLD;
  const crashNear = !crashExceeded && crash >= CRASH_RATE_WARNING_THRESHOLD;
  const anrNear = !anrExceeded && anr >= ANR_RATE_WARNING_THRESHOLD;

  if (crashExceeded || anrExceeded) {
    const issues = [];
    if (crashExceeded) issues.push(`Crash Rate (${(crash * 100).toFixed(2)}%) melebihi ambang batas buruk Google Play (1.09%)`);
    if (anrExceeded) issues.push(`ANR Rate (${(anr * 100).toFixed(2)}%) melebihi ambang batas buruk Google Play (0.47%)`);
    return {
      status: "critical",
      crashNear,
      anrNear,
      crashExceeded,
      anrExceeded,
      message: `⚠️ Bahaya: ${issues.join(", ")}. Game berisiko diturunkan visibilitasnya di Play Store.`
    };
  }

  if (crashNear || anrNear) {
    const warnings = [];
    if (crashNear) warnings.push(`Crash Rate (${(crash * 100).toFixed(2)}%) mendekati ambang batas Play Store (1.09%)`);
    if (anrNear) warnings.push(`ANR Rate (${(anr * 100).toFixed(2)}%) mendekati ambang batas Play Store (0.47%)`);
    return {
      status: "warning",
      crashNear,
      anrNear,
      crashExceeded: false,
      anrExceeded: false,
      message: `Perhatian: ${warnings.join(", ")}.`
    };
  }

  return {
    status: "healthy",
    crashNear: false,
    anrNear: false,
    crashExceeded: false,
    anrExceeded: false,
    message: "Kinerja aplikasi stabil & di bawah ambang batas Google Play (Sehat)."
  };
}

async function queryMetricSet(token: string, packageName: string, metricType: "crashRate" | "anrRate") {
  const metricSetName = metricType === "crashRate" ? "crashRateMetricSet" : "anrRateMetricSet";
  const url = `${REPORTING_API}/apps/${packageName}/${metricSetName}:query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timelineSpec: {
        aggregationPeriod: "DAILY",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`Query ${metricSetName} for ${packageName} failed (${res.status}): ${errText}`);
    return null;
  }

  const data = await res.json();
  const rows = data.rows || [];
  if (rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  let rate = null;
  let distinctUsers = null;

  for (const m of latest.metrics || []) {
    if (m.metric === metricType) {
      rate = m.decimalValue?.value ? Number(m.decimalValue.value) : null;
    } else if (m.metric === "distinctUsers") {
      distinctUsers = m.decimalValue?.value ? Number(m.decimalValue.value) : null;
    }
  }

  return { rate, distinctUsers, raw: data };
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
      return json(200, {
        success: false,
        error: true,
        message: "GOOGLE_SERVICE_ACCOUNT_JSON secret belum dikonfigurasi di Supabase Secrets."
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

    let syncedCount = 0;
    const warnings: string[] = [];

    for (const pkg of packages) {
      try {
        const crashData = await queryMetricSet(token, pkg, "crashRate");
        const anrData = await queryMetricSet(token, pkg, "anrRate");

        const crashRate = crashData?.rate ?? null;
        const anrRate = anrData?.rate ?? null;
        const distinctUsers = crashData?.distinctUsers ?? anrData?.distinctUsers ?? null;

        const assessment = assessVitals(crashRate || 0, anrRate || 0);

        const record = {
          game_id: pkg,
          crash_rate: crashRate,
          anr_rate: anrRate,
          distinct_users: distinctUsers,
          health_status: assessment.status,
          health_message: assessment.message,
          crash_near_threshold: assessment.crashNear,
          anr_near_threshold: assessment.anrNear,
          crash_exceeded_threshold: assessment.crashExceeded,
          anr_exceeded_threshold: assessment.anrExceeded,
          raw_metrics: {
            crash: crashData?.raw || null,
            anr: anrData?.raw || null,
          },
          synced_at: new Date().toISOString(),
        };

        await admin.from("game_vitals_metrics").upsert([record], { onConflict: "game_id" });

        // Update games table summary
        await admin.from("games").update({
          vitals_crash_rate: crashRate,
          vitals_anr_rate: anrRate,
          vitals_health_status: assessment.status,
        }).eq("id", pkg);

        syncedCount++;
      } catch (err: any) {
        console.warn(`Vitals sync skipped/error for ${pkg}:`, err.message || err);
        warnings.push(`${pkg}: ${err.message || err}`);
      }
    }

    return json(200, {
      message: `Synced Android Vitals metrics for ${syncedCount} game(s).`,
      count: syncedCount,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (err: any) {
    return json(500, { message: `Vitals sync failed: ${err.message || err}` });
  }
});
