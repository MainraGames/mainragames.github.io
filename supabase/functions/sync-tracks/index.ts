// supabase/functions/sync-tracks/index.ts
// Syncs Google Play tracks (production, beta, alpha, internal) and staged rollout progress
// using Google Play Developer Publishing API (edits.tracks).
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

export function parseTrackReleases(tracksResponse: any) {
  const tracksList = (tracksResponse && tracksResponse.tracks) || [];
  const result: Record<string, any> = {};

  for (const item of tracksList) {
    if (!item || !item.track) continue;
    const trackName = item.track;
    const releases = item.releases || [];

    const activeRelease = releases.find((r: any) => r.status === "inProgress") ||
                          releases.find((r: any) => r.status === "completed") ||
                          releases[0] || null;

    if (!activeRelease) {
      result[trackName] = {
        track: trackName,
        currentRelease: null,
        releases: [],
      };
      continue;
    }

    const notesMap: Record<string, string> = {};
    if (Array.isArray(activeRelease.releaseNotes)) {
      for (const n of activeRelease.releaseNotes) {
        if (n && n.language && n.text) {
          notesMap[n.language] = n.text;
        }
      }
    }

    let rolloutPct = 100;
    if (typeof activeRelease.userFraction === "number") {
      rolloutPct = Math.round(activeRelease.userFraction * 100);
    } else if (activeRelease.status === "inProgress") {
      rolloutPct = 0;
    }

    result[trackName] = {
      track: trackName,
      currentRelease: {
        name: activeRelease.name || null,
        versionCode: (activeRelease.versionCodes && activeRelease.versionCodes[0]) || null,
        versionCodes: activeRelease.versionCodes || [],
        status: activeRelease.status || "unknown",
        userFraction: typeof activeRelease.userFraction === "number" ? activeRelease.userFraction : 1.0,
        rolloutPercentage: rolloutPct,
        notes: notesMap,
      },
      releases: releases.map((r: any) => ({
        name: r.name || null,
        versionCodes: r.versionCodes || [],
        status: r.status || null,
        userFraction: typeof r.userFraction === "number" ? r.userFraction : null,
      })),
    };
  }

  return result;
}

async function fetchTracksForApp(token: string, packageName: string) {
  // 1. Create an app edit session (read-only inspect)
  const editRes = await fetch(`${API}/applications/${packageName}/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!editRes.ok) {
    const err = await editRes.text();
    throw new Error(`Failed to create edit for ${packageName}: HTTP ${editRes.status} ${err}`);
  }
  const editData = await editRes.json();
  const editId = editData.id;

  try {
    // 2. Fetch tracks within this edit
    const tracksRes = await fetch(`${API}/applications/${packageName}/edits/${editId}/tracks`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!tracksRes.ok) {
      const err = await tracksRes.text();
      throw new Error(`Failed to fetch tracks for ${packageName}: HTTP ${tracksRes.status} ${err}`);
    }
    const rawTracks = await tracksRes.json();
    return parseTrackReleases(rawTracks);
  } finally {
    // 3. Always delete/discard the edit session so no dangling draft edits remain
    try {
      await fetch(`${API}/applications/${packageName}/edits/${editId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (_e) {
      // Ignore cleanup error
    }
  }
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

  const saRaw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "").trim();
  if (!saRaw) {
    return json(200, {
      success: false,
      error: true,
      message: "GOOGLE_SERVICE_ACCOUNT_JSON secret belum dikonfigurasi di Supabase Secrets."
    });
  }

  try {
    const token = await accessToken(JSON.parse(saRaw));

    let packages: string[] = [];
    if (onlyAppId) {
      packages = [onlyAppId];
    } else {
      const { data: games } = await admin.from("games").select("id,appId");
      packages = [...new Set((games || []).map((g: any) => g.appId || g.id).filter(Boolean))] as string[];
    }

    if (packages.length === 0) {
      return json(200, { message: "No games found to inspect tracks.", synced: 0 });
    }

    const updates = [];
    const errors: string[] = [];

    for (const pkg of packages) {
      try {
        const tracks = await fetchTracksForApp(token, pkg);
        const prodTrack = tracks.production || {};
        const prodRel = prodTrack.currentRelease || {};

        const updatePayload: Record<string, any> = {
          track_releases: tracks,
          tracks_synced_at: new Date().toISOString(),
        };

        if (prodRel && prodRel.status) {
          updatePayload.rollout_status = prodRel.status;
          updatePayload.rollout_percentage = prodRel.rolloutPercentage;
          updatePayload.active_version_code = prodRel.versionCode;
          updatePayload.active_version_name = prodRel.name;
          updatePayload.release_notes = prodRel.notes || {};
        }

        const { error } = await admin
          .from("games")
          .update(updatePayload)
          .or(`id.eq.${pkg},appId.eq.${pkg}`);

        if (error) {
          errors.push(`${pkg} db update error: ${error.message}`);
        } else {
          updates.push({
            appId: pkg,
            track: "production",
            status: prodRel.status || "none",
            version: prodRel.name || prodRel.versionCode || "unknown",
            rolloutPercentage: prodRel.rolloutPercentage ?? 100,
          });
        }
      } catch (e: any) {
        errors.push(`${pkg}: ${e.message || e}`);
      }
    }

    return json(200, {
      message: `Tracks synced for ${updates.length} games.`,
      updates,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    return json(500, { message: err.message || String(err) });
  }
});
