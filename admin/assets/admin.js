/* Mainra Games — Admin dashboard logic (Supabase-backed). */
(function () {
    'use strict';

    var sb = null;
    var games = [];
    var highlight = {};
    var reviews = [];
    var editingId = null;   // game id being edited, null = new
    var replyingTo = null;  // review row being replied to

    var $ = function (sel) { return document.querySelector(sel); };
    var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

    function toast(msg, isError) {
        var t = $('#toast');
        t.textContent = msg;
        t.style.display = 'block';
        t.style.background = isError ? 'var(--mainra-orange-deep)' : 'var(--mainra-orange)';
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.style.display = 'none'; }, 3200);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
        });
    }

    function httpsOk(v) {
        try { return new URL(String(v).trim()).protocol === 'https:'; } catch (e) { return false; }
    }

    function icon256(url) {
        if (!url || url.indexOf('play-lh.googleusercontent.com') === -1) return url || '../Assets/img/LogoMainraGames.png';
        return url.split('?')[0].split('=')[0] + '=s256-rw';
    }

    /* ---------- auth ---------- */

    function showShell(user) {
        $('#loginView').style.display = 'none';
        $('#adminShell').classList.add('is-on');
        $('#who').textContent = user.email || 'admin';
        loadAll();
    }

    async function checkAdmin(user) {
        if (!user) { $('#loginView').style.display = 'grid'; return; }
        var res = await sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
        if (res.error) {
            $('#loginError').textContent = 'DB error: ' + res.error.message;
            $('#loginError').classList.remove('hidden');
            $('#loginView').style.display = 'grid';
            return;
        }
        if (!res.data) {
            await sb.auth.signOut();
            $('#loginError').textContent = 'This account is not an admin. Ask an existing admin to grant access.';
            $('#loginError').classList.remove('hidden');
            $('#loginView').style.display = 'grid';
            return;
        }
        showShell(user);
    }

    async function doLogin(e) {
        e.preventDefault();
        var btn = $('#loginBtn');
        btn.disabled = true;
        $('#loginError').classList.add('hidden');
        var res = await sb.auth.signInWithPassword({
            email: $('#loginEmail').value.trim(),
            password: $('#loginPassword').value
        });
        btn.disabled = false;
        if (res.error) {
            $('#loginError').textContent = res.error.message === 'Invalid login credentials'
                ? 'Invalid email or password.' : res.error.message;
            $('#loginError').classList.remove('hidden');
            return;
        }
        await checkAdmin(res.data.user);
    }

    /* ---------- data loading ---------- */

    async function loadGames() {
        var res = await sb.from('games').select('*').order('sort_order', { ascending: true }).order('title');
        if (res.error) { toast('Load games failed: ' + res.error.message, true); return; }
        games = res.data || [];
        renderGamesTable();
        populateGameSelectors();
    }

    async function loadHighlight() {
        var res = await sb.from('site_settings').select('value').eq('key', 'highlight').maybeSingle();
        if (res.error) { toast('Load settings failed: ' + res.error.message, true); return; }
        highlight = (res.data && res.data.value) || {};
        populateHighlightForm();
    }

    async function loadReviews() {
        var res = await sb.from('game_reviews').select('*').order('review_timestamp', { ascending: false });
        if (res.error) { toast('Load reviews failed: ' + res.error.message, true); return; }
        reviews = res.data || [];
        renderReviews();
    }

    function loadAll() { loadGames(); loadHighlight(); loadReviews(); }

    /* ---------- games tab ---------- */

    function renderGamesTable() {
        var tb = $('#gamesTbody');
        if (!games.length) {
            tb.innerHTML = '<tr><td colspan="7" class="muted">No games yet. Click “+ Add Game” or sync from the Play Store.</td></tr>';
            return;
        }
        tb.innerHTML = games.map(function (g) {
            return '<tr>' +
                '<td><img class="thumb" src="' + esc(icon256(g.image)) + '" alt="" loading="lazy" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'"></td>' +
                '<td><strong>' + esc(g.title) + '</strong><br><span class="muted" style="font-size:.8rem">' + esc(g.id) + '</span></td>' +
                '<td>' + esc(g.category || '—') + '</td>' +
                '<td><span class="badge' + (g.status === 'Released' ? ' ok' : ' warn') + '">' + esc(g.status || '—') + '</span></td>' +
                '<td>' + (g.rating != null ? '★ ' + esc(g.rating) : '—') + '</td>' +
                '<td>' + (g.featured ? '<span class="badge ok">yes</span>' : '<span class="muted">no</span>') + '</td>' +
                '<td><div class="actions">' +
                    '<button class="btn ghost small" data-edit="' + esc(g.id) + '" type="button">Edit</button>' +
                    '<button class="btn danger small" data-del="' + esc(g.id) + '" type="button">Delete</button>' +
                '</div></td>' +
            '</tr>';
        }).join('');
        $$('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openGameModal(b.dataset.edit); }); });
        $$('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteGame(b.dataset.del); }); });
    }

    function populateGameSelectors() {
        var opts = games.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.title) + '</option>'; }).join('');
        $('#hlGame').innerHTML = '<option value="">— none —</option>' + opts;
        $('#reviewGameFilter').innerHTML = '<option value="">All games</option>' + opts;
    }

    function formToGame(fd) {
        var shots = String(fd.get('screenshots') || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        var ratingRaw = String(fd.get('rating') || '').trim();
        return {
            id: String(fd.get('id') || '').trim(),
            title: String(fd.get('title') || '').trim(),
            description: String(fd.get('description') || '').trim(),
            image: String(fd.get('image') || '').trim(),
            screenshots: shots,
            playLink: String(fd.get('playLink') || '').trim(),
            category: String(fd.get('category') || '').trim() || 'Casual',
            status: String(fd.get('status') || 'Released'),
            releaseDate: String(fd.get('releaseDate') || '').trim() || null,
            featured: String(fd.get('featured')) === 'true',
            platform: String(fd.get('platform') || 'Android'),
            rating: ratingRaw === '' ? null : Number(ratingRaw),
            appId: String(fd.get('id') || '').trim() || null
        };
    }

    function openGameModal(id) {
        editingId = id || null;
        var form = $('#gameForm');
        form.reset();
        var g = id ? games.find(function (x) { return x.id === id; }) : null;
        $('#gmTitle').textContent = g ? 'Edit Game — ' + g.title : 'Add Game';
        if (g) {
            form.elements.id.value = g.id; form.elements.id.readOnly = true;
            form.elements.title.value = g.title || '';
            form.elements.description.value = g.description || '';
            form.elements.image.value = g.image || '';
            form.elements.screenshots.value = (g.screenshots || []).join('\n');
            form.elements.playLink.value = g.playLink || '';
            form.elements.category.value = g.category || '';
            form.elements.status.value = g.status || 'Released';
            form.elements.platform.value = g.platform || 'Android';
            form.elements.releaseDate.value = (g.releaseDate || '').slice(0, 10);
            form.elements.featured.value = g.featured ? 'true' : 'false';
            form.elements.rating.value = g.rating == null ? '' : g.rating;
        } else {
            form.elements.id.readOnly = false;
        }
        $('#gameModal').showModal();
    }

    async function saveGame(e) {
        e.preventDefault();
        var form = $('#gameForm');
        var g = formToGame(new FormData(form));
        if (!g.id || !g.title) { toast('ID and title are required', true); return; }
        if (g.playLink && !httpsOk(g.playLink)) { toast('Play Store link must be https', true); return; }
        var res;
        if (editingId) {
            res = await sb.from('games').update(g).eq('id', editingId);
        } else {
            var exists = games.some(function (x) { return x.id === g.id; });
            if (exists) { toast('A game with that ID already exists', true); return; }
            res = await sb.from('games').insert(Object.assign({ sort_order: games.length }, g));
        }
        if (res.error) { toast('Save failed: ' + res.error.message, true); return; }
        $('#gameModal').close();
        toast('Game saved ✓');
        loadGames();
    }

    async function deleteGame(id) {
        var g = games.find(function (x) { return x.id === id; });
        if (!g) return;
        if (!confirm('Delete "' + g.title + '" from the site? (The Play Store app itself is not affected.)')) return;
        var res = await sb.from('games').delete().eq('id', id);
        if (res.error) { toast('Delete failed: ' + res.error.message, true); return; }
        if (highlight && String(highlight.gameId) === String(id)) {
            highlight = Object.assign({}, highlight, { gameId: '', active: false });
            await sb.from('site_settings').upsert({ key: 'highlight', value: highlight });
        }
        toast('Game deleted');
        loadGames();
        loadHighlight();
    }

    /* ---------- highlight tab ---------- */

    function populateHighlightForm() {
        $('#hlGame').value = highlight.gameId || '';
        $('#hlActive').value = highlight.active ? 'true' : 'false';
        $('#hlTitle').value = highlight.customTitle || '';
        $('#hlYoutube').value = highlight.youtubeUrl || '';
        $('#hlDesc').value = highlight.customDescription || '';
        var st = highlight.stats || {};
        $('#stGameplay').value = st.gameplay || '';
        $('#stCharacters').value = st.characters || '';
        $('#stWorlds').value = st.worlds || '';
    }

    async function saveHighlight() {
        var st = {};
        if ($('#stGameplay').value.trim()) st.gameplay = $('#stGameplay').value.trim();
        if ($('#stCharacters').value.trim()) st.characters = $('#stCharacters').value.trim();
        if ($('#stWorlds').value.trim()) st.worlds = $('#stWorlds').value.trim();
        var yt = $('#hlYoutube').value.trim();
        if (yt && !httpsOk(yt)) { toast('Trailer URL must be https', true); return; }
        var next = {
            gameId: $('#hlGame').value,
            customTitle: $('#hlTitle').value.trim(),
            customDescription: $('#hlDesc').value.trim(),
            youtubeUrl: yt,
            stats: st,
            active: $('#hlActive').value === 'true',
            lastUpdated: new Date().toISOString()
        };
        var res = await sb.from('site_settings').upsert({ key: 'highlight', value: next }, { onConflict: 'key' });
        if (res.error) { toast('Save failed: ' + res.error.message, true); return; }
        highlight = next;
        toast('Featured section saved ✓');
    }

    function exportJson() {
        var data = { games: games, highlight: highlight };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'games-data.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /* ---------- reviews tab ---------- */

    function starStr(n) {
        n = Number(n) || 0;
        return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
    }

    function reviewStateFilterValue() { return $('#reviewStateFilter').value; }

    function renderReviews() {
        var gid = $('#reviewGameFilter').value;
        var state = reviewStateFilterValue();
        var list = reviews.filter(function (r) {
            if (gid && String(r.game_id) !== String(gid)) return false;
            if (state === 'unanswered' && (r.reply_text || '').trim()) return false;
            if (state === 'answered' && !(r.reply_text || '').trim()) return false;
            return true;
        });
        var box = $('#reviewsList');
        if (!list.length) {
            box.innerHTML = '<div class="card muted">No reviews match. Click “Fetch new reviews” to pull the latest from the Play Store, or add reviews manually in Supabase.</div>';
            return;
        }
        box.innerHTML = list.map(function (r, i) {
            var g = games.find(function (x) { return String(x.id) === String(r.game_id); });
            var answered = (r.reply_text || '').trim();
            return '<div class="card">' +
                '<div class="actions" style="justify-content:space-between;align-items:flex-start;gap:1rem">' +
                    '<div style="min-width:0">' +
                        '<strong>' + esc(r.author_name || 'Anonymous') + '</strong> ' +
                        '<span style="color:var(--mainra-gold)">' + starStr(r.star_rating) + '</span>' +
                        (g ? ' <span class="muted">· ' + esc(g.title) + '</span>' : '') +
                        (r.review_timestamp ? ' <span class="muted">· ' + new Date(r.review_timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        (r.device ? '<br><span class="muted" style="font-size:.8rem">' + esc(r.device) + (r.versionCode ? ' · v' + esc(r.versionCode) : '') + '</span>' : '') +
                        '<p style="margin:.6rem 0 0">' + esc(r.content || '—') + '</p>' +
                        (answered ? '<p style="margin:.6rem 0 0;padding:.6rem .8rem;border-left:3px solid var(--mainra-success);background:rgba(127,209,161,.06)"><span class="muted" style="font-size:.78rem">Mainra Games replied:</span><br>' + esc(r.reply_text) + '</p>' : '') +
                    '</div>' +
                    '<div class="actions"><button class="btn ' + (answered ? 'ghost' : '') + ' small" data-reply="' + i + '" type="button">' + (answered ? 'Edit reply' : 'Reply') + '</button></div>' +
                '</div>' +
            '</div>';
        }).join('');
        // map filtered index back to full row
        $$('[data-reply]').forEach(function (b) {
            b.addEventListener('click', function () { openReply(list[Number(b.dataset.reply)]); });
        });
    }

    var PRESETS = [
        { label: 'Thanks', text: 'Thank you for your feedback! We are glad you are enjoying the game. More updates are on the way. 🎮' },
        { label: 'Apology+fix', text: 'Sorry about that! We have noted this issue and a fix is coming in the next update. Feel free to reach out at support@mainragames.com.' },
        { label: 'Ask for details', text: 'Thanks for the review! Could you share a bit more about what you experienced (device and game version)? We will look into it right away.' }
    ];

    function openReply(row) {
        replyingTo = row;
        $('#rpContext').innerHTML = '<div class="card" style="margin:0"><strong>' + esc(row.author_name) + '</strong> ' +
            '<span style="color:var(--mainra-gold)">' + starStr(row.star_rating) + '</span>' +
            '<p style="margin:.5rem 0 0">' + esc(row.content || '—') + '</p></div>';
        $('#rpText').value = row.reply_text || '';
        $('#rpPresets').innerHTML = PRESETS.map(function (p, i) {
            return '<button class="btn ghost small" type="button" data-preset="' + i + '">' + esc(p.label) + '</button>';
        }).join('');
        $$('[data-preset]').forEach(function (b) {
            b.addEventListener('click', function () { $('#rpText').value = PRESETS[Number(b.dataset.preset)].text; });
        });
        var isPlayStore = row.source === 'playstore';
        $('#rpNote').textContent = isPlayStore
            ? 'Saved as your reply draft. The sync job (Fetch new reviews / daily Action) posts it to Google Play automatically — Google allows one reply per review.'
            : 'Reply stored locally in the dashboard database.';
        $('#replyModal').showModal();
    }

    async function saveReply() {
        if (!replyingTo) return;
        var text = $('#rpText').value.trim();
        var patch = text ? { reply_text: text, reply_timestamp: Date.now() } : { reply_text: null, reply_timestamp: null };
        var res = await sb.from('game_reviews').update(patch).eq('review_id', replyingTo.review_id);
        if (res.error) { toast('Save failed: ' + res.error.message, true); return; }
        replyingTo.reply_text = patch.reply_text;
        replyingTo.reply_timestamp = patch.reply_timestamp;
        $('#replyModal').close();
        toast('Reply saved ✓');
        renderReviews();
    }

    /* ---------- sync actions (Edge Function, needs Google service account) ---------- */

    async function callFunction(name, body) {
        var res = await sb.functions.invoke(name, { body: body || {} });
        if (res.error) {
            var msg = String(res.error.message || res.error);
            if (msg.indexOf('not found') !== -1 || msg.indexOf('404') !== -1) {
                toast('Edge Function "' + name + '" is not deployed yet — see README (Admin) section.', true);
            } else {
                toast(name + ' failed: ' + msg, true);
            }
            return;
        }
        var data = res.data || {};
        toast((data.message || name + ' done') + ' ✓');
        loadGames(); loadReviews();
    }

    /* ---------- tabs ---------- */

    var TITLES = { games: 'Games', featured: 'Featured & Site', reviews: 'Reviews' };
    function selectTab(name) {
        $$('.admin-nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
        $('#tabTitle').textContent = TITLES[name] || name;
        try { localStorage.setItem('mainra-admin-tab', name); } catch (e) {}
    }

    /* ---------- boot ---------- */

    function init() {
        if (typeof window.supabaseClient === 'undefined' || !window.supabaseClient) {
            $('#loginView').style.display = 'grid';
            $('#loginError').textContent = 'Supabase client failed to load. Check network / supabase-config.js.';
            $('#loginError').classList.remove('hidden');
            return;
        }
        sb = window.supabaseClient;

        $('#loginForm').addEventListener('submit', doLogin);
        $('#logoutBtn').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
        $$('.admin-nav button').forEach(function (b) { b.addEventListener('click', function () { selectTab(b.dataset.tab); }); });
        $('#newGameBtn').addEventListener('click', function () { openGameModal(null); });
        $('#gmClose').addEventListener('click', function () { $('#gameModal').close(); });
        $('#gmCancel').addEventListener('click', function () { $('#gameModal').close(); });
        $('#gameForm').addEventListener('submit', saveGame);
        $('#saveHighlightBtn').addEventListener('click', saveHighlight);
        $('#exportJsonBtn').addEventListener('click', exportJson);
        $('#rpClose').addEventListener('click', function () { $('#replyModal').close(); });
        $('#rpCancel').addEventListener('click', function () { $('#replyModal').close(); });
        $('#rpSave').addEventListener('click', saveReply);
        $('#reviewGameFilter').addEventListener('change', renderReviews);
        $('#reviewStateFilter').addEventListener('change', renderReviews);
        $('#syncGamesBtn').addEventListener('click', function () { callFunction('sync-playstore'); });
        $('#syncReviewsBtn').addEventListener('click', function () { callFunction('sync-reviews'); });

        sb.auth.onAuthStateChange(function (event, session) {
            if (event === 'SIGNED_OUT') {
                $('#adminShell').classList.remove('is-on');
                $('#loginView').style.display = 'grid';
            }
        });

        var saved = 'games';
        try { saved = localStorage.getItem('mainra-admin-tab') || 'games'; } catch (e) {}
        selectTab(saved);

        sb.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (session) checkAdmin(session.user);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
