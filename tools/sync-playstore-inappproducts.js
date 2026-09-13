/**
 * Google Play In-App Products ⇄ Supabase sync
 * Can be run manually or via GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { mapInAppProduct, summarizeInAppProducts } = require('./inappproducts-utils');
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

async function fetchInAppProducts(token, packageName) {
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/inappproducts?maxResults=100`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`Google API ${packageName} error (${res.status}): ${errTxt}`);
    }
    const data = await res.json();
    const items = (data && data.inappproduct) || [];
    return items.map(raw => mapInAppProduct(raw, packageName)).filter(Boolean);
}

async function main() {
    const url = need('SUPABASE_URL');
    const key = need('SUPABASE_SECRET_KEY');
    const saRaw = need('GOOGLE_SERVICE_ACCOUNT_JSON');
    const sa = JSON.parse(saRaw);

    console.log('Authenticating with Google Play Developer API (In-App Products)...');
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

    console.log(`Checking in-app products for ${packages.length} package(s)...`);
    const allProducts = [];

    const tally = createSyncTally('sync-inappproducts');
    for (const pkg of packages) {
        tally.attempt();
        try {
            console.log(`Fetching in-app products for ${pkg}...`);
            const products = await fetchInAppProducts(token, pkg);
            console.log(`  -> found ${products.length} product(s)`);
            if (products.length > 0) {
                const rows = products.map(p => ({
                    id: `${pkg}:${p.sku}`,
                    ...p
                }));
                const upsertRes = await fetch(`${url}/rest/v1/game_inapp_products`, {
                    method: 'POST',
                    headers: {
                        apikey: key,
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        Prefer: 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(rows)
                });
                if (!upsertRes.ok) {
                    console.error(`  -> DB upsert failed: ${upsertRes.status} ${await upsertRes.text()}`);
                } else {
                    console.log(`  -> synced ${products.length} product(s) to DB`);
                    allProducts.push(...products);
                }
            }
        } catch (err) {
            console.warn(`  -> skipped/error for ${pkg}: ${err.message}`);
            tally.failure();
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    const summary = summarizeInAppProducts(allProducts);
    console.log('\n--- In-App Products Summary ---');
    console.log(`Total products synced: ${summary.totalProducts}`);
    console.log(`Active: ${summary.activeCount}`);
    console.log(`Managed (one-time items): ${summary.managedCount}`);
    console.log(`Subscriptions: ${summary.subscriptionCount}`);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error in sync-playstore-inappproducts:', err);
        process.exit(1);
    });
}
