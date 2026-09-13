/**
 * Google Play Voided Purchases ⇄ Supabase sync (cancellations, refunds, chargebacks).
 * Can be run manually or via GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON (needs View Financial Reports permission)
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { mapVoidedPurchase, summarizeVoidedPurchases } = require('./voided-purchases-utils');
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

async function fetchVoidedPurchases(token, packageName) {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/voidedpurchases?maxResults=1000&type=1`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`Google API ${packageName} error (${res.status}): ${errTxt}`);
    }
    const data = await res.json();
    const items = (data && data.voidedPurchases) || [];
    return items.map(raw => mapVoidedPurchase(raw, packageName)).filter(Boolean);
}

async function main() {
    const url = need('SUPABASE_URL');
    const key = need('SUPABASE_SECRET_KEY');
    const saRaw = need('GOOGLE_SERVICE_ACCOUNT_JSON');
    const sa = JSON.parse(saRaw);

    console.log('Authenticating with Google Play Developer API (voided purchases)...');
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

    console.log(`Checking voided purchases for ${packages.length} package(s)...`);
    const allRecords = [];

    const tally = createSyncTally('sync-voided-purchases');
    for (const pkg of packages) {
        tally.attempt();
        try {
            console.log(`Fetching voided purchases for ${pkg}...`);
            const records = await fetchVoidedPurchases(token, pkg);
            console.log(`  -> found ${records.length} voided/refunded transaction(s)`);
            if (records.length > 0) {
                const upsertRes = await fetch(`${url}/rest/v1/game_voided_purchases`, {
                    method: 'POST',
                    headers: {
                        apikey: key,
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        Prefer: 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(records)
                });
                if (!upsertRes.ok) {
                    console.error(`  -> failed to upsert into Supabase: ${upsertRes.status} ${await upsertRes.text()}`);
                } else {
                    console.log(`  -> successfully synced ${records.length} record(s) to DB`);
                    allRecords.push(...records);
                }
            }
        } catch (err) {
            console.warn(`  -> skipped/error for ${pkg}: ${err.message}`);
            tally.failure();
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    const summary = summarizeVoidedPurchases(allRecords);
    console.log('\n--- Voided Purchases Summary ---');
    console.log(`Total voided: ${summary.totalVoided}`);
    console.log(`Fraud / Chargeback risks: ${summary.fraudOrChargebackCount}`);
    console.log('By Initiator:', summary.bySource);
    console.log('By Reason:', summary.byReason);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error in sync-playstore-voided-purchases:', err);
        process.exit(1);
    });
}
