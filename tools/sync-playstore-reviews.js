/**
 * Google Play reviews ⇄ Supabase sync (used by GitHub Actions, runnable locally).
 *
 * Env vars:
 *   SUPABASE_URL              project URL
 *   SUPABASE_SECRET_KEY       service_role / sb_secret_ key
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service account JSON (Play Console → Users & permissions)
 *   PLAY_PACKAGE_NAMES        optional comma list; defaults to appIds from the games table
 *
 * Behaviour:
 *   1. Fetch recent reviews per package (reviews.list)
 *   2. Upsert into game_reviews (preserves admin reply drafts)
 *   3. Push pending admin replies to Google Play (reviews.reply, max 1 reply per review)
 */
const crypto = require('crypto');
const { assertOkResponse } = require('./http-utils.js');

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

function mapReview(r, appId) {
    const c = (r.comments && r.comments[0] && r.comments[0].userComment) || {};
    const reply = (r.comments && r.comments[0] && r.comments[0].developerComment) || {};
    const lm = (c.lastModified && (c.lastModified.seconds || c.lastModified.serverValue)) || null;

    let content = '';
    if (typeof c.text === 'string') {
        content = c.text;
    } else if (Array.isArray(c.text)) {
        content = c.text[0] || '';
    }

    let replyText = null;
    if (typeof reply.text === 'string') {
        replyText = reply.text;
    } else if (Array.isArray(reply.text)) {
        replyText = reply.text[0] || '';
    }

    const dm = c.deviceMetadata || (Array.isArray(c.deviceMetadata) ? c.deviceMetadata[0] : null) || {};
    let deviceName = dm.productName || '';
    if (!deviceName && dm.manufacturer && (dm.deviceModel || c.device)) {
        deviceName = `${dm.manufacturer} ${dm.deviceModel || c.device}`.trim();
    }
    if (!deviceName) {
        deviceName = c.device || dm.deviceModel || null;
    }

    const row = {
        review_id: r.reviewId,
        game_id: appId,
        author_name: (r.authorName && (r.authorName.displayName || r.authorName)) || c.authorName || 'Anonymous',
        content: content,
        star_rating: c.starRating || null,
        versionCode: c.appVersionName || (c.appVersionCode ? String(c.appVersionCode) : null),
        device: deviceName || c.device || null,
        device_name: deviceName || null,
        android_os_version: typeof c.androidOsVersion === 'number' ? c.androidOsVersion : null,
        app_version_code: typeof c.appVersionCode === 'number' ? c.appVersionCode : null,
        app_version_name: c.appVersionName || null,
        thumbs_up_count: typeof c.thumbsUpCount === 'number' ? c.thumbsUpCount : 0,
        thumbs_down_count: typeof c.thumbsDownCount === 'number' ? c.thumbsDownCount : 0,
        device_metadata: dm && Object.keys(dm).length > 0 ? dm : null,
        review_timestamp: lm ? Number(lm) * 1000 : null,
        lang: c.reviewerLanguage || c.reviewLanguage || null,
        source: 'playstore'
    };

    if (replyText) {
        row.reply_text = replyText;
        const replyLm = reply.lastModified && (reply.lastModified.seconds || reply.lastModified.serverValue);
        row.replySentAt = replyLm ? new Date(Number(replyLm) * 1000).toISOString() : new Date().toISOString();
    }
    return row;
}

async function listReviews(token, packageName) {
    const out = [];
    let pageToken = '';
    do {
        const qs = new URLSearchParams({ packageName, maxResults: '50' });
        if (pageToken) qs.set('token', pageToken);
        const res = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/reviews?${qs}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        await assertOkResponse(res, `list reviews ${packageName}`);
        const data = await res.json();
        out.push(...(data.reviews || []));
        pageToken = (data.tokenPagination && data.tokenPagination.nextPageToken) || '';
    } while (pageToken && out.length < 150);
    return out;
}

async function supabase(cfg, table, rows, { onConflict, columns } = {}) {
    const qs = new URLSearchParams();
    if (onConflict) qs.set('on_conflict', onConflict);
    if (columns) qs.set('columns', columns);
    const res = await fetch(`${cfg.url}/rest/v1/${table}?${qs}`, {
        method: 'POST',
        headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(rows)
    });
    if (!res.ok) throw new Error(`${table} write failed: ${res.status} ${await res.text()}`);
}

async function supabaseSelect(cfg, table, params) {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${cfg.url}/rest/v1/${table}?${qs}`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }
    });
    if (!res.ok) throw new Error(`${table} read failed: ${res.status} ${await res.text()}`);
    return res.json();
}

async function main() {
    const cfg = { url: need('SUPABASE_URL').replace(/\/+$/, ''), key: need('SUPABASE_SECRET_KEY') };
    const saRaw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!saRaw) {
        console.log('GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping review sync. Create a service account in Play Console (Users & permissions → grant "Reply to reviews") and add its JSON as a repo secret.');
        return;
    }
    const sa = JSON.parse(saRaw);
    const token = await getAccessToken(sa);

    let packages = (process.env.PLAY_PACKAGE_NAMES || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    if (packages.length === 0) {
        const games = await supabaseSelect(cfg, 'games', { select: 'appId' });
        packages = [...new Set(games.map(g => g.appId).filter(Boolean))];
    }
    console.log('Packages:', packages.join(', '));

    let fetched = 0;
    for (const pkg of packages) {
        const raw = await listReviews(token, pkg);
        const rows = raw.map(r => mapReview(r, pkg));
        if (rows.length === 0) continue;
        // Upsert WITHOUT touching reply_* so admin drafts survive.
        await supabase(cfg, 'game_reviews', rows, {
            onConflict: 'review_id',
            columns: 'review_id,game_id,author_name,content,star_rating,versionCode,device,review_timestamp,lang,source,synced_at'
        });
        fetched += rows.length;
    }
    console.log(`Fetched ${fetched} reviews.`);

    // Push pending admin replies (Play allows exactly one reply per review).
    const pending = await supabaseSelect(cfg, 'game_reviews', {
        select: 'review_id,game_id,reply_text',
        reply_text: 'not.is.null',
        'replySentAt': 'is.null',
        source: 'eq.playstore',
        limit: '25'
    });
    for (const row of pending) {
        const res = await fetch(
            `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${row.game_id}/reviews/${row.review_id}:reply`,
            {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ replyText: row.reply_text })
            }
        );
        if (res.ok) {
            await supabase(cfg, 'game_reviews', [{ review_id: row.review_id, replySentAt: new Date().toISOString() }],
                { onConflict: 'review_id', columns: 'review_id,replySentAt' });
            console.log(`Posted reply to ${row.review_id}`);
        } else {
            console.error(`  reply ${row.review_id} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
    }
}

if (require.main === module) {
    main().catch(err => { console.error('reviews sync failed:', err.message); process.exit(1); });
}

module.exports = { main, mapReview };
