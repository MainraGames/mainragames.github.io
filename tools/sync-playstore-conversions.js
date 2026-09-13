/**
 * Google Play Developer Reporting API (Store Listing Conversions) ⇄ Supabase sync
 * Can be run manually or via GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { parseConversionRates } = require('./conversion-utils');
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
        scope: 'https://www.googleapis.com/auth/playdeveloperreporting',
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

async function queryConversion(token, packageName) {
    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${packageName}/conversionRateMetricSet:query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            timelineSpec: {
                aggregationPeriod: 'DAY',
                startTime: {
                    year: new Date(Date.now() - 14 * 86400000).getUTCFullYear(),
                    month: new Date(Date.now() - 14 * 86400000).getUTCMonth() + 1,
                    day: new Date(Date.now() - 14 * 86400000).getUTCDate()
                }
            },
            dimensions: ['countryCode', 'trafficSource'],
            metrics: ['storeListingVisitors', 'storeListingAcquisitions']
        })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google Play Reporting API HTTP ${res.status}: ${text}`);
    }
    return res.json();
}

async function main() {
    const supabaseUrl = need('SUPABASE_URL').replace(/\/$/, '');
    const supabaseKey = need('SUPABASE_SECRET_KEY');
    const sa = JSON.parse(need('GOOGLE_SERVICE_ACCOUNT_JSON'));

    const token = await getAccessToken(sa);
    console.log('Obtained Google Play Developer Reporting API access token.');

    // Fetch package names from Supabase
    let packageNames = (process.env.PLAY_PACKAGE_NAMES || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    if (packageNames.length === 0) {
        const res = await fetch(`${supabaseUrl}/rest/v1/games?select=id,appId`, {
            headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`
            }
        });
        if (!res.ok) throw new Error(`Failed to load games: ${res.status} ${await res.text()}`);
        const rows = await res.json();
        packageNames = rows.map(r => r.appId || r.id).filter(Boolean);
    }

    console.log(`Syncing store listing conversions for: ${packageNames.join(', ')}`);

    const tally = createSyncTally('sync-conversions');
    for (const pkg of packageNames) {
        tally.attempt();
        try {
            console.log(`Querying conversions for ${pkg}…`);
            const data = await queryConversion(token, pkg);
            const parsed = parseConversionRates(data);

            const metricDate = new Date().toISOString().split('T')[0];
            const dbRows = parsed.breakdowns.map(b => ({
                id: `${pkg}:${metricDate}:${b.country}:${b.source}`,
                game_id: pkg,
                metric_date: metricDate,
                country: b.country,
                traffic_source: b.source,
                visitors: b.visitors,
                acquisitions: b.acquisitions,
                conversion_rate: b.ratePercent,
                synced_at: new Date().toISOString()
            }));

            if (dbRows.length > 0) {
                const upsertRes = await fetch(`${supabaseUrl}/rest/v1/game_conversion_metrics`, {
                    method: 'POST',
                    headers: {
                        apikey: supabaseKey,
                        Authorization: `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(dbRows)
                });
                if (!upsertRes.ok) console.warn(`Failed to upsert conversion rows: ${await upsertRes.text()}`);
            }

            // Update games table
            await fetch(`${supabaseUrl}/rest/v1/games?id=eq.${pkg}`, {
                method: 'PATCH',
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    conversion_visitors: parsed.totalVisitors,
                    conversion_acquisitions: parsed.totalAcquisitions,
                    conversion_rate: parsed.conversionRatePercent,
                    conversion_synced_at: new Date().toISOString()
                })
            });

            console.log(`✓ ${pkg}: ${parsed.totalVisitors} visitors, ${parsed.totalAcquisitions} downloads (${parsed.conversionRatePercent}%)`);
        } catch (err) {
            console.warn(`⚠️ Skipped ${pkg}: ${err.message}`);
            tally.failure();
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    console.log('Conversion metrics sync completed.');
}

main().catch(err => {
    console.error('Fatal error syncing conversions:', err);
    process.exit(1);
});
