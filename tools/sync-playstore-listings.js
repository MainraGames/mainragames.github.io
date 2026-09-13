/**
 * Google Play Store Listings (edits.listings) ⇄ Supabase sync
 * Can be run manually or via GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { parseStoreListingsResponse, mergeListingIntoGame } = require('./store-listings-utils');
const { createSyncTally } = require('./http-utils.js');

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

async function createEdit(token, packageName) {
    const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Create edit failed (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.id;
}

async function deleteEdit(token, packageName, editId) {
    try {
        await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${editId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
    } catch (_) {}
}

async function fetchListings(token, packageName, editId) {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/edits/${editId}/listings`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Fetch listings failed (${res.status}): ${await res.text()}`);
    return await res.json();
}

async function main() {
    const url = need('SUPABASE_URL');
    const key = need('SUPABASE_SECRET_KEY');
    const saRaw = need('GOOGLE_SERVICE_ACCOUNT_JSON');
    const sa = JSON.parse(saRaw);

    console.log('Authenticating with Google Play Developer API (Store Listings)...');
    const token = await getAccessToken(sa);

    let packages = (process.env.PLAY_PACKAGE_NAMES || '')
        .split(',').map(s => s.trim()).filter(Boolean);

    if (packages.length === 0) {
        const res = await fetch(`${url}/rest/v1/games?select=id,appId`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        if (!res.ok) throw new Error(`Fetch games failed: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        packages = [...new Set(rows.map(g => g.appId || g.id).filter(Boolean))];
    }

    console.log(`Pulling store listings for ${packages.length} package(s)...`);
    let totalSynced = 0;

    const tally = createSyncTally('sync-listings');
    for (const pkg of packages) {
        tally.attempt();
        let editId = null;
        try {
            editId = await createEdit(token, pkg);
            const rawResponse = await fetchListings(token, pkg, editId);
            const listings = parseStoreListingsResponse(rawResponse, pkg);
            console.log(`  -> found ${listings.length} locale(s) for ${pkg}`);

            if (listings.length > 0) {
                const upsertRes = await fetch(`${url}/rest/v1/game_store_listings`, {
                    method: 'POST',
                    headers: {
                        apikey: key,
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        Prefer: 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(listings)
                });
                if (!upsertRes.ok) {
                    console.error(`  -> DB upsert listings failed: ${upsertRes.status} ${await upsertRes.text()}`);
                } else {
                    totalSynced += listings.length;
                    const merged = mergeListingIntoGame(listings, 'id-ID');
                    await fetch(`${url}/rest/v1/games?id=eq.${pkg}`, {
                        method: 'PATCH',
                        headers: {
                            apikey: key,
                            Authorization: `Bearer ${key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(merged)
                    });
                }
            }
        } catch (err) {
            console.warn(`  -> skipped/error for ${pkg}: ${err.message}`);
            tally.failure();
        } finally {
            if (editId) await deleteEdit(token, pkg, editId);
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    console.log(`\n--- Store Listings Summary ---`);
    console.log(`Total multi-language listings synced: ${totalSynced}`);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error in sync-playstore-listings:', err);
        process.exit(1);
    });
}
