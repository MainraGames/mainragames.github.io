/**
 * Google Play Tracks & Staged Rollout ⇄ Supabase sync
 * Can be run manually or in GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { parseTrackReleases } = require('./tracks-utils.js');
const { createSyncTally } = require('./http-utils.js');

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

function need(name) {
    const v = (process.env[name] || '').trim();
    if (!v) throw new Error(`Missing env var ${name}`);
    return v;
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(unsigned);
    const jwt = `${unsigned}.${b64url(sign.sign(sa.private_key))}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    const tok = await res.json();
    return tok.access_token;
}

async function fetchTracksForApp(token, packageName) {
    const editRes = await fetch(`${API}/applications/${packageName}/edits`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
    if (!editRes.ok) {
        const err = await editRes.text();
        throw new Error(`Failed to create edit for ${packageName}: HTTP ${editRes.status} ${err}`);
    }
    const editData = await editRes.json();
    const editId = editData.id;

    try {
        const tracksRes = await fetch(`${API}/applications/${packageName}/edits/${editId}/tracks`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        if (!tracksRes.ok) {
            const err = await tracksRes.text();
            throw new Error(`Failed to fetch tracks for ${packageName}: HTTP ${tracksRes.status} ${err}`);
        }
        const rawTracks = await tracksRes.json();
        return parseTrackReleases(rawTracks);
    } finally {
        try {
            await fetch(`${API}/applications/${packageName}/edits/${editId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (_e) {
            // Ignore cleanup errors
        }
    }
}

async function run() {
    const supabaseUrl = need('SUPABASE_URL').replace(/\/$/, '');
    const supabaseKey = need('SUPABASE_SECRET_KEY');
    const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    if (!saRaw) {
        console.log('[sync-tracks] GOOGLE_SERVICE_ACCOUNT_JSON not provided. Skipping track sync.');
        return;
    }

    let sa;
    try {
        sa = JSON.parse(saRaw);
    } catch (e) {
        throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e.message}`);
    }

    console.log('[sync-tracks] Authenticating with Google Play Developer API...');
    const token = await getAccessToken(sa);

    let packages = (process.env.PLAY_PACKAGE_NAMES || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    if (packages.length === 0) {
        const gRes = await fetch(`${supabaseUrl}/rest/v1/games?select=id,appId`, {
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`
            }
        });
        if (!gRes.ok) throw new Error(`Failed to fetch games from Supabase: ${gRes.status} ${await gRes.text()}`);
        const games = await gRes.json();
        packages = [...new Set(games.map(g => g.appId || g.id).filter(Boolean))];
    }

    console.log(`[sync-tracks] Found ${packages.length} game(s) to inspect tracks: ${packages.join(', ')}`);

    const tally = createSyncTally('sync-tracks');
    for (const pkg of packages) {
        tally.attempt();
        try {
            console.log(`[sync-tracks] Inspecting tracks for ${pkg}...`);
            const tracks = await fetchTracksForApp(token, pkg);
            const prodTrack = tracks.production || {};
            const prodRel = prodTrack.currentRelease || {};

            const updatePayload = {
                track_releases: tracks,
                tracks_synced_at: new Date().toISOString()
            };

            if (prodRel && prodRel.status) {
                updatePayload.rollout_status = prodRel.status;
                updatePayload.rollout_percentage = prodRel.rolloutPercentage;
                updatePayload.active_version_code = prodRel.versionCode;
                updatePayload.active_version_name = prodRel.name;
                updatePayload.release_notes = prodRel.notes || {};
            }

            const patchRes = await fetch(`${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(pkg)}`, {
                method: 'PATCH',
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal'
                },
                body: JSON.stringify(updatePayload)
            });

            if (!patchRes.ok) {
                console.error(`[sync-tracks] Failed to update DB for ${pkg}: HTTP ${patchRes.status} ${await patchRes.text()}`);
            } else {
                console.log(`[sync-tracks] ✓ Updated ${pkg}: Track status=${prodRel.status || 'none'}, Version=${prodRel.name || prodRel.versionCode || 'unknown'}, Rollout=${prodRel.rolloutPercentage ?? 100}%`);
            }
        } catch (err) {
            console.error(`[sync-tracks] Error processing ${pkg}:`, err.message || err);
            tally.failure();
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    console.log('[sync-tracks] Finished track synchronization.');
}

if (require.main === module) {
    run().catch(err => {
        console.error('[sync-tracks] Fatal:', err);
        process.exit(1);
    });
}

module.exports = {
    fetchTracksForApp
};
