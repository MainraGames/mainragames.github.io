/**
 * Pull games + highlight from Supabase into Assets/data/games-data.json.
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY
 * Usage: node tools/pull-supabase.js   (run AFTER update-games so admin edits win)
 */
const path = require('path');
const fs = require('fs');
const { assertOkResponse } = require('./http-utils.js');

const DATA_PATH = path.join(__dirname, '..', 'Assets', 'data', 'games-data.json');

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.log('⏭️  SUPABASE_URL / SUPABASE_SECRET_KEY not set — keeping scraped JSON as-is.');
        return;
    }

    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const gamesRes = await fetch(`${url}/rest/v1/games?select=*&order=sort_order.asc.nullslast,title.asc`, { headers });
    await assertOkResponse(gamesRes, 'games');
    const games = await gamesRes.json();
    if (!Array.isArray(games) || games.length === 0) {
        console.warn('⚠️  No games in Supabase — keeping scraped JSON.');
        return;
    }
    const settingsRes = await fetch(`${url}/rest/v1/site_settings?key=eq.highlight&select=value`, { headers });
    await assertOkResponse(settingsRes, 'site_settings');
    const settingsRow = await settingsRes.json();
    const highlight = (settingsRow[0] && settingsRow[0].value) || null;
    if (highlight && !highlight.lastUpdated) {
        highlight.lastUpdated = new Date().toISOString();
    }

    const out = {
        games: games.map(g => ({
            id: g.id,
            title: g.title,
            description: g.description || '',
            image: g.image || '',
            screenshots: g.screenshots || [],
            playLink: g.playLink || `https://play.google.com/store/apps/details?id=${g.id}`,
            category: g.category || 'Game',
            status: g.status || 'Released',
            releaseDate: g.releaseDate || null,
            featured: !!g.featured,
            platform: g.platform || 'Android',
            rating: g.rating != null ? Number(g.rating) : null,
            appId: g.appId || g.id
        })),
        ...(highlight ? { highlight } : {})
    };

    fs.writeFileSync(DATA_PATH, JSON.stringify(out, null, 2), 'utf8');
    console.log(`✅ Supabase → games-data.json: ${out.games.length} game(s), highlight=${highlight ? 'from CMS' : 'kept'}`);
}

main().catch((err) => {
    console.error('❌ pull-supabase failed:', err.message);
    process.exit(1);
});
