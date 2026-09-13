/**
 * Google Play Developer Reporting API (Android Vitals) ⇄ Supabase sync
 * Can be run manually or via GitHub Actions.
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from games table
 */
const crypto = require('crypto');
const { parseVitalsQueryResponse, assessVitalsHealth } = require('./vitals-utils');
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

async function queryMetric(token, packageName, metricType) {
    const metricSetName = metricType === 'crashRate' ? 'crashRateMetricSet' : 'anrRateMetricSet';
    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${packageName}/${metricSetName}:query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            timelineSpec: { aggregationPeriod: 'DAILY' }
        })
    });
    if (!res.ok) {
        console.warn(`Query ${metricSetName} for ${packageName} failed: HTTP ${res.status}`);
        return null;
    }
    return await res.json();
}

async function main() {
    const url = need('SUPABASE_URL');
    const key = need('SUPABASE_SECRET_KEY');
    const saRaw = need('GOOGLE_SERVICE_ACCOUNT_JSON');
    const sa = JSON.parse(saRaw);

    console.log('Authenticating with Google Play Developer Reporting API (Vitals)...');
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

    console.log(`Syncing Android Vitals for ${packages.length} game(s)...`);
    let count = 0;

    const tally = createSyncTally('sync-vitals');
    for (const pkg of packages) {
        tally.attempt();
        try {
            const rawCrash = await queryMetric(token, pkg, 'crashRate');
            const rawAnr = await queryMetric(token, pkg, 'anrRate');

            const crashInfo = parseVitalsQueryResponse(rawCrash, 'crashRate');
            const anrInfo = parseVitalsQueryResponse(rawAnr, 'anrRate');

            const health = assessVitalsHealth(crashInfo.rate, anrInfo.rate);

            const row = {
                game_id: pkg,
                crash_rate: crashInfo.rate,
                anr_rate: anrInfo.rate,
                distinct_users: crashInfo.distinctUsers || anrInfo.distinctUsers || null,
                health_status: health.status,
                health_message: health.message,
                crash_near_threshold: health.crashNearThreshold,
                anr_near_threshold: health.anrNearThreshold,
                crash_exceeded_threshold: health.crashExceededThreshold,
                anr_exceeded_threshold: health.anrExceededThreshold,
                synced_at: new Date().toISOString()
            };

            const upsertRes = await fetch(`${url}/rest/v1/game_vitals_metrics`, {
                method: 'POST',
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=merge-duplicates'
                },
                body: JSON.stringify([row])
            });

            if (upsertRes.ok) {
                count++;
                await fetch(`${url}/rest/v1/games?id=eq.${pkg}`, {
                    method: 'PATCH',
                    headers: {
                        apikey: key,
                        Authorization: `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        vitals_crash_rate: crashInfo.rate,
                        vitals_anr_rate: anrInfo.rate,
                        vitals_health_status: health.status
                    })
                });
            }
        } catch (err) {
            console.warn(`Error syncing vitals for ${pkg}: ${err.message}`);
            tally.failure();
        }
    }

    const { exitCode } = tally.finish();
    if (exitCode) process.exitCode = exitCode;

    console.log(`Successfully updated vitals metrics for ${count} game(s).`);
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error in sync-playstore-vitals:', err);
        process.exit(1);
    });
}
