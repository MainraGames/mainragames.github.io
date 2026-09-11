/**
 * Mirror Assets/data/games-data.json into the Supabase CMS tables.
 * Existing rows are NOT overwritten (insert-only) so admin edits in the
 * dashboard always win; new games published on Play Store still appear in
 * Supabase automatically. Use the dashboard's "Sync from Play Store" for a
 * deliberate content refresh (its Edge Function protects featured/sort_order).
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_… / service_role key)
 * Usage: node tools/sync-supabase.js
 */
const fs = require('fs');
const path = require('path');

const GAMES_DATA_PATH = path.join(__dirname, '..', 'Assets', 'data', 'games-data.json');

function getConfig() {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) return null;
    return { url: url.replace(/\/+$/, ''), key };
}

async function postgrest(cfg, table, rows, onConflict, mode) {
    const resolution = mode === 'ignore' ? 'ignore-duplicates' : 'merge-duplicates';
    const res = await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${onConflict}`, {
        method: 'POST',
        headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            'Content-Type': 'application/json',
            Prefer: `resolution=${resolution},return=minimal`
        },
        body: JSON.stringify(rows)
    });
    if (!res.ok) {
        throw new Error(`${table} upsert failed: ${res.status} ${await res.text()}`);
    }
}

async function main() {
    const cfg = getConfig();
    if (!cfg) {
        console.log('SUPABASE_URL / SUPABASE_SECRET_KEY not set — skipping Supabase mirror.');
        return;
    }

    const data = JSON.parse(fs.readFileSync(GAMES_DATA_PATH, 'utf8'));
    const games = (data.games || []).map((g, i) => ({
        id: g.id,
        title: g.title,
        description: g.description || '',
        image: g.image || '',
        screenshots: g.screenshots || [],
        playLink: g.playLink || '',
        category: g.category || 'Casual',
        status: g.status || 'Released',
        releaseDate: g.releaseDate || null,
        featured: !!g.featured,
        platform: g.platform || 'Android',
        rating: g.rating == null ? null : Number(g.rating),
        appId: g.appId || g.id,
        sort_order: i
    }));

    if (games.length > 0) {
        await postgrest(cfg, 'games', games, 'id', 'ignore');
        console.log(`Mirrored ${games.length} games to Supabase (insert-only; existing rows untouched).`);
    } else {
        console.log('No games in JSON — skipping games mirror (protecting DB from empty scrape).');
    }

    if (data.highlight) {
        await postgrest(cfg, 'site_settings', [{ key: 'highlight', value: data.highlight }], 'key', 'ignore');
        console.log('Highlight settings mirrored to Supabase (insert-only; existing kept).');
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error('sync-supabase failed:', err.message);
        process.exit(1);
    });
}

module.exports = { main, getConfig };
