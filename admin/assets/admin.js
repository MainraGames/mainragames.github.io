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
        renderFeaturedGrid();
        renderAnalyticsTab();
    }

    async function loadHighlight() {
        var res = await sb.from('site_settings').select('value').eq('key', 'highlight').maybeSingle();
        if (res.error) { toast('Load settings failed: ' + res.error.message, true); return; }
        highlight = (res.data && res.data.value) || {};
        renderFeaturedGrid();
    }

    async function loadReviews() {
        var res = await sb.from('game_reviews').select('*').order('review_timestamp', { ascending: false });
        if (res.error) { toast('Load reviews failed: ' + res.error.message, true); return; }
        reviews = res.data || [];
        renderReviews();
        renderAnalyticsTab();
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
                    '<button class="btn ghost small" data-view-analytics="' + esc(g.id) + '" type="button">Analytics</button>' +
                    '<button class="btn danger small" data-del="' + esc(g.id) + '" type="button">Delete</button>' +
                '</div></td>' +
            '</tr>';
        }).join('');
        $$('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openGameModal(b.dataset.edit); }); });
        $$('[data-view-analytics]').forEach(function (b) { b.addEventListener('click', function () { openAnalyticsTab(b.dataset.viewAnalytics); }); });
        $$('[data-del]').forEach(function (b) { b.addEventListener('click', function () { deleteGame(b.dataset.del); }); });
    }

    function populateGameSelectors() {
        var opts = games.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.title) + '</option>'; }).join('');
        $('#reviewGameFilter').innerHTML = '<option value="">All games</option>' + opts;
        $('#analyticsGameFilter').innerHTML = '<option value="">-- Select Game --</option>' + opts;
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

    /* ---------- featured tab (auto content from Play Store data) ---------- */

    function renderFeaturedGrid() {
        var box = $('#featuredGrid');
        if (!games.length) {
            box.innerHTML = '<div class="card muted">No games yet. Click “Refresh from Play Store”.</div>';
            return;
        }
        var currentId = (highlight && highlight.gameId) || '';
        var isActive = !!(highlight && highlight.active);
        box.innerHTML = games.map(function (g, i) {
            var picked = String(g.id) === String(currentId) && isActive;
            return '<button type="button" class="feat-card' + (picked ? ' picked' : '') + '" data-feat="' + i + '">' +
                '<img class="feat-icon" src="' + esc(icon256(g.image)) + '" alt="" loading="lazy" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'">' +
                '<span class="feat-name">' + esc(g.title) + '</span>' +
                '<span class="feat-meta">' + esc(g.category || '') + (g.rating != null ? ' · ★ ' + esc(g.rating) : '') + '</span>' +
                (picked ? '<span class="badge ok feat-badge">Featured</span>' : '') +
            '</button>';
        }).join('');
        $$('[data-feat]').forEach(function (b) {
            b.addEventListener('click', function () { pickFeatured(games[Number(b.dataset.feat)]); });
        });
    }

    async function pickFeatured(g) {
        if (!g) return;
        var next = {
            gameId: g.id,
            active: true,
            lastUpdated: new Date().toISOString()
        };
        var btns = $$('[data-feat]');
        btns.forEach(function (b) { b.disabled = true; });
        var res = await sb.from('site_settings').upsert({ key: 'highlight', value: next }, { onConflict: 'key' });
        btns.forEach(function (b) { b.disabled = false; });
        if (res.error) { toast('Save failed: ' + res.error.message, true); return; }
        highlight = next;
        toast('“' + g.title + '” is now featured ✓');
        renderFeaturedGrid();
    }

    async function hideFeatured() {
        var next = Object.assign({}, highlight, { active: false, lastUpdated: new Date().toISOString() });
        var res = await sb.from('site_settings').upsert({ key: 'highlight', value: next }, { onConflict: 'key' });
        if (res.error) { toast('Save failed: ' + res.error.message, true); return; }
        highlight = next;
        toast('Featured section hidden');
        renderFeaturedGrid();
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

    /* ---------- game modal: analytics + per-game reviews ---------- */

    /* ---------- analytics tab (overview + deep dive) ---------- */

    function parseNumericInstalls(str) {
        if (!str) return 0;
        var m = String(str).replace(/[^0-9]/g, '');
        return parseInt(m, 10) || 0;
    }

    function formatNumberCompact(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M+';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K+';
        return num.toLocaleString();
    }

    function openAnalyticsTab(id) {
        selectTab('analytics');
        var select = $('#analyticsGameFilter');
        select.value = id || '';
        renderAnalyticsTab();
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function renderAnalyticsTab() {
        var id = $('#analyticsGameFilter').value;
        if (!id) {
            $('#analyticsOverview').style.display = 'block';
            $('#analyticsSingleGame').style.display = 'none';
            $('#syncAnalyticsBtn').dataset.gid = '';
            $('#syncAnalyticsBtn').textContent = '↻ Sync All from Play Store';
            renderAnalyticsOverview();
        } else {
            $('#analyticsOverview').style.display = 'none';
            $('#analyticsSingleGame').style.display = 'block';
            var g = games.find(function (x) { return x.id === id; });
            if (g) {
                $('#syncAnalyticsBtn').dataset.gid = g.appId || g.id;
                $('#syncAnalyticsBtn').textContent = '↻ Sync ' + (g.title.split(':')[0] || 'Game');
                $('#singleGameReviewTitle').textContent = 'Reviews for ' + g.title;
                loadTabAnalytics(g);
                loadTabReviews(g.id);
            }
        }
    }

    async function renderAnalyticsOverview() {
        // Compute studio KPI totals
        var totalGames = games.length;
        $('#kpiTotalGames').textContent = totalGames;

        // Categories breakdown
        var categories = {};
        var totalEstDownloads = 0;
        var ratedGames = [];
        games.forEach(function (g) {
            if (g.category) categories[g.category] = (categories[g.category] || 0) + 1;
            totalEstDownloads += parseNumericInstalls(g.installs);
            if (g.rating != null && g.rating > 0) ratedGames.push(Number(g.rating));
        });

        var catList = Object.keys(categories).map(function (c) { return c + ' (' + categories[c] + ')'; }).join(', ');
        $('#kpiCategories').textContent = catList || 'Mainra Studio';

        $('#kpiTotalDownloads').textContent = totalEstDownloads > 0 ? formatNumberCompact(totalEstDownloads) : (games.some(function(g){ return !!g.installs; }) ? '1,000+' : 'N/A');

        if (ratedGames.length > 0) {
            var avg = ratedGames.reduce(function (a, b) { return a + b; }, 0) / ratedGames.length;
            $('#kpiAvgRating').textContent = '★ ' + avg.toFixed(1);
            $('#kpiRatedCount').textContent = 'From ' + ratedGames.length + ' rated game(s)';
        } else {
            $('#kpiAvgRating').textContent = '5.0';
            $('#kpiRatedCount').textContent = 'Based on early player reviews';
        }

        // Reviews metrics from reviews array
        var totalReviews = reviews.length;
        var unreplied = reviews.filter(function (r) { return !(r.reply_text || '').trim(); }).length;
        $('#kpiTotalReviews').textContent = totalReviews;
        $('#kpiPendingReplies').textContent = unreplied > 0 ? unreplied + ' pending replies' : 'All caught up ✓';

        // Render Breakdown Table
        var tbody = $('#overviewBreakdownTbody');
        if (!games.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="muted">No games loaded yet.</td></tr>';
        } else {
            tbody.innerHTML = games.map(function (g) {
                var gReviews = reviews.filter(function (r) { return String(r.game_id) === String(g.id); });
                var gUnreplied = gReviews.filter(function (r) { return !(r.reply_text || '').trim(); }).length;
                var ratingStr = g.rating != null ? '★ ' + Number(g.rating).toFixed(1) : (gReviews.length ? '★ 5.0' : '—');
                var installsStr = g.installs || '—';

                return '<tr>' +
                    '<td>' +
                        '<div style="display:flex;align-items:center;gap:.75rem">' +
                            '<img class="thumb" src="' + esc(icon256(g.image)) + '" alt="" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'">' +
                            '<div>' +
                                '<strong>' + esc(g.title) + '</strong>' +
                                '<div class="muted" style="font-size:.75rem">' + esc(g.id) + '</div>' +
                            '</div>' +
                        '</div>' +
                    '</td>' +
                    '<td>' + esc(g.category || 'Game') + '</td>' +
                    '<td><strong>' + esc(installsStr) + '</strong></td>' +
                    '<td><span style="color:var(--mainra-gold);font-weight:600">' + ratingStr + '</span></td>' +
                    '<td>' + gReviews.length + '</td>' +
                    '<td>' + (gUnreplied > 0 ? '<span class="badge warn">' + gUnreplied + ' need reply</span>' : '<span class="badge ok">0</span>') + '</td>' +
                    '<td>' +
                        '<button type="button" class="btn ghost small" data-drilldown="' + esc(g.id) + '">View Details →</button>' +
                    '</td>' +
                '</tr>';
            }).join('');

            $$('[data-drilldown]').forEach(function (b) {
                b.addEventListener('click', function () {
                    $('#analyticsGameFilter').value = b.dataset.drilldown;
                    renderAnalyticsTab();
                });
            });
        }

        // Render Overview Latest Reviews Feed
        var feedBox = $('#overviewLatestReviews');
        if (!reviews.length) {
            feedBox.innerHTML = '<div class="muted">No reviews recorded yet. Click "Sync from Play Store" above to fetch latest reviews.</div>';
        } else {
            var recent10 = reviews.slice(0, 6);
            feedBox.innerHTML = recent10.map(function (r, i) {
                var g = games.find(function (x) { return String(x.id) === String(r.game_id); });
                var answered = (r.reply_text || '').trim();
                var transBoxId = 'trans_feed_' + i;
                var hasForeignContent = r.content && r.content.trim() && r.lang !== 'id';

                return '<div class="review-item" style="border-bottom:1px solid var(--mainra-line);padding:.9rem 0">' +
                    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap">' +
                        '<div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">' +
                            '<strong>' + esc(r.author_name || 'Anonymous') + '</strong>' +
                            ' <span style="color:var(--mainra-gold)">' + starStr(r.star_rating) + '</span>' +
                            getLangBadge(r.lang) +
                            (g ? ' <span class="muted" style="font-size:.8rem">on ' + esc(g.title) + '</span>' : '') +
                            (r.review_timestamp ? ' <span class="muted" style="font-size:.8rem">· ' + new Date(r.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        '</div>' +
                        '<button class="btn-admin ghost" style="font-size:.75rem;padding:.2rem .6rem" data-reply-overview="' + i + '" type="button">' +
                            (answered ? '✎ Edit reply' : '↩ Reply') +
                        '</button>' +
                    '</div>' +
                    '<p style="margin:.45rem 0 0;font-size:.92rem;color:var(--mainra-white)">' + esc(r.content || '—') + '</p>' +
                    (hasForeignContent ?
                        '<div>' +
                            '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
                            '<div id="' + transBoxId + '" class="trans-box" style="display:none"></div>' +
                        '</div>' : '') +
                    (answered ? '<p style="margin:.6rem 0 0;padding:.6rem .8rem;border-left:3px solid var(--mainra-success);background:rgba(127,209,161,.06);font-size:.85rem"><span class="muted" style="font-size:.75rem">Mainra replied:</span><br>' + esc(r.reply_text) + '</p>' : '') +
                '</div>';
            }).join('');

            $$('[data-reply-overview]').forEach(function (btn) {
                btn.addEventListener('click', function () { openReply(recent10[Number(btn.dataset.replyOverview)]); });
            });
            wireTranslationButtons();
        }
    }

    async function loadTabAnalytics(g) {
        $('#tabStatDownloads').textContent = g.installs || 'N/A';
        $('#tabStatRating').textContent = g.rating != null ? '★ ' + Number(g.rating).toFixed(1) : '★ 5.0';

        var gReviews = reviews.filter(function (r) { return String(r.game_id) === String(g.id); });
        $('#tabStatReviewsCount').textContent = gReviews.length;
        var unreplied = gReviews.filter(function (r) { return !(r.reply_text || '').trim(); }).length;
        $('#tabStatUnreplied').textContent = unreplied > 0 ? unreplied + ' unreplied' : 'All replied';

        if (gReviews.length > 0) {
            var repliedCount = gReviews.length - unreplied;
            var pct = Math.round((repliedCount / gReviews.length) * 100);
            $('#tabStatResponseRate').textContent = pct + '%';
        } else {
            $('#tabStatResponseRate').textContent = '100%';
        }
    }

    async function loadTabReviews(gameId) {
        var box = $('#tabReviewsList');
        var res = await sb.from('game_reviews')
            .select('*')
            .eq('game_id', gameId)
            .order('review_timestamp', { ascending: false })
            .limit(30);
        if (res.error) { box.innerHTML = '<div class="muted">Could not load reviews: ' + esc(res.error.message) + '</div>'; return; }
        var rows = res.data || [];
        if (!rows.length) {
            box.innerHTML = '<div class="muted" style="margin:0">No reviews synced yet for this title. Click "Sync from Play Store" above to fetch.</div>';
            return;
        }
        box.innerHTML = rows.map(function (r, i) {
            var answered = (r.reply_text || '').trim();
            var transBoxId = 'trans_tab_' + i;
            var hasForeignContent = r.content && r.content.trim() && r.lang !== 'id';

            return '<div class="review-item" data-rvidx="' + i + '" style="border-bottom:1px solid var(--mainra-line);padding:1rem 0">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap">' +
                    '<span>' +
                        '<strong>' + esc(r.author_name || 'Anonymous') + '</strong>' +
                        ' <span style="color:var(--mainra-gold)">' + starStr(r.star_rating) + '</span>' +
                        ' ' + getLangBadge(r.lang) +
                        (r.review_timestamp ? ' <span class="muted" style="font-size:.85rem">· ' + new Date(r.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        (r.device ? ' <span class="muted" style="font-size:.85rem">· ' + esc(r.device) + (r.versionCode ? ' v' + esc(r.versionCode) : '') + '</span>' : '') +
                    '</span>' +
                    '<button class="btn-admin ghost" style="font-size:.8rem;padding:.25rem .75rem" data-reply-tab="' + i + '" type="button">' +
                        (answered ? '✎ Edit reply' : '↩ Reply') +
                    '</button>' +
                '</div>' +
                '<p style="margin:.6rem 0 0;font-size:1rem;color:var(--mainra-white)">' + esc(r.content || '—') + '</p>' +
                (hasForeignContent ?
                    '<div>' +
                        '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
                        '<div id="' + transBoxId + '" class="trans-box" style="display:none"></div>' +
                    '</div>' : '') +
                (answered ? '<p style="margin:.8rem 0 0;padding:.8rem 1rem;border-left:4px solid var(--mainra-success);background:rgba(127,209,161,.08);font-size:.9rem"><span class="muted" style="font-size:.8rem;text-transform:uppercase;letter-spacing:0.05em">Mainra replied:</span><br>' + esc(r.reply_text) + '</p>' : '') +
            '</div>';
        }).join('');
        
        var _rows = rows;
        $$('[data-reply-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () { openReply(_rows[Number(btn.dataset.replyTab)]); });
        });
        wireTranslationButtons();
    }

    async function syncTabAnalytics(appId) {
        var btn = $('#syncAnalyticsBtn');
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        var res = await sb.functions.invoke('sync-reviews', { body: appId ? { appId: appId } : {} });
        btn.disabled = false;
        btn.textContent = appId ? '↻ Sync Game' : '↻ Sync from Play Store';
        if (res.error) { toast('Sync failed: ' + String(res.error.message || res.error), true); return; }
        toast(((res.data && res.data.message) || 'Sync done') + ' ✓');
        
        // Reload games and reviews to refresh entire analytics view
        await Promise.all([loadGames(), loadReviews()]);
        renderAnalyticsTab();
    }

    /* ---------- translation & language helpers ---------- */

    var LANG_NAMES = {
        id: { name: 'Indonesian', flag: '🇮🇩' },
        en: { name: 'English', flag: '🇬🇧' },
        fa: { name: 'Persian', flag: '🇮🇷' },
        ar: { name: 'Arabic', flag: '🇸🇦' },
        es: { name: 'Spanish', flag: '🇪🇸' },
        pt: { name: 'Portuguese', flag: '🇧🇷' },
        ru: { name: 'Russian', flag: '🇷🇺' },
        hi: { name: 'Hindi', flag: '🇮🇳' },
        tr: { name: 'Turkish', flag: '🇹🇷' },
        fr: { name: 'French', flag: '🇫🇷' },
        de: { name: 'German', flag: '🇩🇪' },
        ja: { name: 'Japanese', flag: '🇯🇵' },
        ko: { name: 'Korean', flag: '🇰🇷' },
        vi: { name: 'Vietnamese', flag: '🇻🇳' },
        th: { name: 'Thai', flag: '🇹🇭' },
        ms: { name: 'Malay', flag: '🇲🇾' },
        it: { name: 'Italian', flag: '🇮🇹' },
        zh: { name: 'Chinese', flag: '🇨🇳' }
    };

    function getLangBadge(code) {
        if (!code) return '';
        var c = String(code).toLowerCase().slice(0, 2);
        var meta = LANG_NAMES[c] || { name: code.toUpperCase(), flag: '🌐' };
        return '<span class="badge lang" title="Language: ' + esc(meta.name) + '">' + meta.flag + ' ' + esc(meta.name) + '</span>';
    }

    var translationCache = {};

    async function translateText(text, targetLang) {
        targetLang = targetLang || 'id';
        var key = targetLang + ':' + text;
        if (translationCache[key]) return translationCache[key];
        try {
            var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);
            var res = await fetch(url);
            if (!res.ok) throw new Error('Translation HTTP ' + res.status);
            var data = await res.json();
            var translated = (data[0] || []).map(function (s) { return s[0]; }).join('');
            var detected = data[2] || '';
            var result = { text: translated, detectedLang: detected };
            translationCache[key] = result;
            return result;
        } catch (e) {
            console.warn('translate error:', e);
            return { text: text, detectedLang: '' };
        }
    }

    function wireTranslationButtons() {
        $$('[data-trans-btn]').forEach(function (btn) {
            btn.onclick = async function () {
                var targetId = btn.dataset.transTarget;
                var originalText = btn.dataset.transText;
                var box = $('#' + targetId);
                if (!box) return;

                if (box.dataset.state === 'translated') {
                    // Toggle back to original text
                    box.style.display = 'none';
                    box.dataset.state = 'hidden';
                    btn.innerHTML = '🌐 Terjemahkan ke Indonesia';
                    return;
                }

                btn.innerHTML = '⏳ Menerjemahkan…';
                var res = await translateText(originalText, 'id');
                var sourceName = (LANG_NAMES[res.detectedLang] && LANG_NAMES[res.detectedLang].name) || res.detectedLang || 'Asing';
                box.innerHTML = '<div style="font-size:.76rem;color:var(--mainra-muted);margin-bottom:.25rem;display:flex;align-items:center;gap:.3rem"><span>🌐 Diterjemahkan dari ' + esc(sourceName) + ':</span></div>' + esc(res.text);
                box.style.display = 'block';
                box.dataset.state = 'translated';
                btn.innerHTML = '✕ Sembunyikan terjemahan';
            };
        });
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
            var transBoxId = 'trans_rev_' + i;
            var hasForeignContent = r.content && r.content.trim() && r.lang !== 'id';

            return '<div class="card">' +
                '<div class="actions" style="justify-content:space-between;align-items:flex-start;gap:1rem">' +
                    '<div style="min-width:0;flex:1">' +
                        '<div style="display:flex;align-items:center;gap:.55rem;flex-wrap:wrap">' +
                            '<strong>' + esc(r.author_name || 'Anonymous') + '</strong>' +
                            '<span style="color:var(--mainra-gold)">' + starStr(r.star_rating) + '</span>' +
                            getLangBadge(r.lang) +
                            (g ? '<span class="muted" style="font-size:.85rem">· ' + esc(g.title) + '</span>' : '') +
                            (r.review_timestamp ? '<span class="muted" style="font-size:.85rem">· ' + new Date(r.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        '</div>' +
                        (r.device ? '<div class="muted small" style="margin-top:.25rem">' + esc(r.device) + (r.versionCode ? ' · App v' + esc(r.versionCode) : '') + '</div>' : '') +
                        '<p style="margin:.6rem 0 0;font-size:.95rem;line-height:1.45">' + esc(r.content || '—') + '</p>' +
                        (hasForeignContent ?
                            '<div>' +
                                '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
                                '<div id="' + transBoxId + '" class="trans-box" style="display:none"></div>' +
                            '</div>' : '') +
                        (answered ? '<p style="margin:.7rem 0 0;padding:.6rem .8rem;border-left:3px solid var(--mainra-success);background:rgba(127,209,161,.06)"><span class="muted" style="font-size:.78rem">Mainra Games replied:</span><br>' + esc(r.reply_text) + '</p>' : '') +
                    '</div>' +
                    '<div class="actions"><button class="btn ' + (answered ? 'ghost' : '') + ' small" data-reply="' + i + '" type="button">' + (answered ? 'Edit reply' : 'Reply') + '</button></div>' +
                '</div>' +
            '</div>';
        }).join('');
        // map filtered index back to full row
        $$('[data-reply]').forEach(function (b) {
            b.addEventListener('click', function () { openReply(list[Number(b.dataset.reply)]); });
        });
        wireTranslationButtons();
    }

    var PRESETS = [
        { label: 'Thanks', text: 'Thank you for your feedback! We are glad you are enjoying the game. More updates are on the way. 🎮' },
        { label: 'Apology+fix', text: 'Sorry about that! We have noted this issue and a fix is coming in the next update. Feel free to reach out at mainragames@gmail.com.' },
        { label: 'Ask for details', text: 'Thanks for the review! Could you share a bit more about what you experienced (device and game version)? We will look into it right away.' }
    ];

    function openReply(row) {
        replyingTo = row;
        var isPlayStore = row.source === 'playstore';
        
        // Context box: author, stars, game name, content
        var gameObj = games.find(function (g) { return g.id === row.game_id; });
        var gameName = gameObj ? gameObj.title : (row.game_id || 'Game');
        
        $('#rpBadge').textContent = isPlayStore ? 'Google Play Store' : 'Local Review';
        var hasForeignModal = row.content && row.content.trim() && row.lang !== 'id';

        $('#rpContext').innerHTML = 
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">' +
                '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
                    '<strong>' + esc(row.author_name || 'Anonymous') + '</strong>' +
                    getLangBadge(row.lang) +
                '</div>' +
                '<span style="color:var(--mainra-gold);font-size:1.05rem">' + starStr(row.star_rating) + '</span>' +
            '</div>' +
            '<div class="muted small" style="margin-bottom:.5rem">' + esc(gameName) + (row.device ? ' · Device: ' + esc(row.device) : '') + (row.versionCode ? ' (v' + esc(row.versionCode) + ')' : '') + '</div>' +
            '<p style="margin:0;font-size:.9rem;color:var(--mainra-ink);line-height:1.45">' + esc(row.content || '—') + '</p>' +
            (hasForeignModal ?
                '<div style="margin-top:.4rem">' +
                    '<button type="button" class="btn-trans" id="rpModalTransBtn">🌐 Terjemahkan ke Indonesia</button>' +
                    '<div id="rpModalTransBox" class="trans-box" style="display:none"></div>' +
                '</div>' : '');

        if (hasForeignModal) {
            var mBtn = $('#rpModalTransBtn');
            var mBox = $('#rpModalTransBox');
            if (mBtn && mBox) {
                mBtn.onclick = async function () {
                    if (mBox.dataset.state === 'translated') {
                        mBox.style.display = 'none';
                        mBox.dataset.state = 'hidden';
                        mBtn.innerHTML = '🌐 Terjemahkan ke Indonesia';
                        return;
                    }
                    mBtn.innerHTML = '⏳ Menerjemahkan…';
                    var res = await translateText(row.content, 'id');
                    var sourceName = (LANG_NAMES[res.detectedLang] && LANG_NAMES[res.detectedLang].name) || res.detectedLang || 'Asing';
                    mBox.innerHTML = '<div style="font-size:.76rem;color:var(--mainra-muted);margin-bottom:.25rem"><span>🌐 Diterjemahkan dari ' + esc(sourceName) + ':</span></div>' + esc(res.text);
                    mBox.style.display = 'block';
                    mBox.dataset.state = 'translated';
                    mBtn.innerHTML = '✕ Sembunyikan terjemahan';
                };
            }
        }
        
        var replyVal = row.reply_text || '';
        var charEl = $('#rpCharCount');
        var textEl = $('#rpText');
        textEl.value = replyVal;
        
        function updateCount() {
            var len = textEl.value.length;
            charEl.textContent = len + ' / 350';
            charEl.style.color = len > 330 ? 'var(--mainra-accent-hover)' : '';
        }
        textEl.oninput = updateCount;
        updateCount();

        $('#rpPresets').innerHTML = PRESETS.map(function (p, i) {
            return '<button class="btn ghost small" type="button" data-preset="' + i + '" style="font-size:.78rem;padding:.25rem .55rem">' + esc(p.label) + '</button>';
        }).join('');
        $$('[data-preset]').forEach(function (b) {
            b.addEventListener('click', function () {
                textEl.value = PRESETS[Number(b.dataset.preset)].text;
                updateCount();
            });
        });

        var banner = $('#rpStatusBanner');
        var btnText = $('#rpBtnText');
        var btnIcon = $('#rpBtnIcon');

        if (row.replySentAt) {
            banner.style.display = 'block';
            banner.style.background = 'rgba(127,209,161,.1)';
            banner.style.border = '1px solid rgba(127,209,161,.3)';
            banner.style.color = 'var(--mainra-success)';
            var dateStr = new Date(row.replySentAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
            banner.innerHTML = '✓ <strong>Published to Play Store:</strong> ' + esc(dateStr) + '<br><span class="muted small" style="color:var(--mainra-muted)">Editing will update your live response on Google Play.</span>';
            btnText.textContent = 'Update on Google Play';
            btnIcon.textContent = '🔄';
        } else if (row.reply_text) {
            banner.style.display = 'block';
            banner.style.background = 'rgba(255,179,0,.1)';
            banner.style.border = '1px solid rgba(255,179,0,.3)';
            banner.style.color = 'var(--mainra-gold)';
            banner.innerHTML = '⏳ <strong>Draft saved locally:</strong> Not yet published to Google Play.';
            btnText.textContent = 'Post to Google Play';
            btnIcon.textContent = '🚀';
        } else {
            banner.style.display = 'none';
            btnText.textContent = 'Post to Google Play';
            btnIcon.textContent = '🚀';
        }

        $('#rpNote').textContent = isPlayStore
            ? (row.replySentAt
                ? 'When you click "Update on Google Play", your edited reply is immediately published and updated live on the Play Store listing.'
                : 'When you click "Post to Google Play", your reply is immediately published to Google Play.')
            : 'Stored in the database for this game.';

        $('#replyModal').showModal();
    }

    async function saveReplyDraft() {
        if (!replyingTo) return;
        var text = $('#rpText').value.trim();
        var patch = text ? { reply_text: text, reply_timestamp: Date.now() } : { reply_text: null, reply_timestamp: null, replySentAt: null };
        var res = await sb.from('game_reviews').update(patch).eq('review_id', replyingTo.review_id);
        if (res.error) { toast('Save draft failed: ' + res.error.message, true); return; }
        replyingTo.reply_text = patch.reply_text;
        replyingTo.reply_timestamp = patch.reply_timestamp;
        if (!text) replyingTo.replySentAt = null;
        $('#replyModal').close();
        toast('Reply draft saved ✓');
        
        var gameId = replyingTo.game_id;
        loadReviews();
        if (gameId && $('#tab-analytics').classList.contains('active')) {
            loadTabReviews(gameId);
        }
    }

    async function postReplyToGoogle() {
        if (!replyingTo) return;
        var text = $('#rpText').value.trim();
        if (!text) {
            toast('Please enter a reply before posting.', true);
            return;
        }
        var btn = $('#rpPostGoogle');
        var btnText = $('#rpBtnText');
        var origText = btnText.textContent;
        btn.disabled = true;
        btnText.textContent = 'Posting to Play Store…';

        try {
            // Ensure session token is fresh
            var sessRes = await sb.auth.getSession();
            var session = sessRes && sessRes.data && sessRes.data.session;
            if (!session) {
                toast('Session expired. Please sign out and sign in again.', true);
                btn.disabled = false;
                btnText.textContent = origText;
                return;
            }

            var res = await sb.functions.invoke('sync-reviews', {
                body: {
                    action: 'reply',
                    reviewId: replyingTo.review_id,
                    appId: replyingTo.game_id,
                    replyText: text
                }
            });
            if (res.error) {
                var errStr = String(res.error.message || res.error);
                if (errStr.indexOf('Failed to send a request') !== -1) {
                    toast('Network/auth error reaching Google Play service. Please try again.', true);
                } else {
                    toast('Google Play reply failed: ' + errStr, true);
                }
                return;
            }
            var data = res.data || {};
            replyingTo.reply_text = text;
            replyingTo.replySentAt = data.replySentAt || new Date().toISOString();
            $('#replyModal').close();
            toast('✓ Reply successfully posted to Google Play Store!');
            
            var gameId = replyingTo.game_id;
            loadReviews();
            if (gameId && $('#tab-analytics').classList.contains('active')) {
                loadTabReviews(gameId);
            }
        } catch (e) {
            toast('Error: ' + e.message, true);
        } finally {
            btn.disabled = false;
            btnText.textContent = origText;
        }
    }

    /* ---------- sync actions (Edge Function, needs Google service account) ---------- */

    async function callFunction(name, body) {
        toast('Syncing with Play Store…');
        var res = await sb.functions.invoke(name, { body: body || {} });
        if (res.error) {
            var msg = String(res.error.message || res.error);
            if (msg.indexOf('Failed to send a request') !== -1) {
                toast(name + ': Network/Session issue. Please try signing out and signing back in.', true);
            } else if (msg.indexOf('not found') !== -1 || msg.indexOf('404') !== -1) {
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

    var TITLES = { games: 'Games', featured: 'Featured & Site', analytics: 'Analytics Overview', reviews: 'Reviews' };
    function selectTab(name) {
        $$('.admin-nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
        $('#tabTitle').textContent = TITLES[name] || name;
        window.scrollTo({ top: 0, behavior: 'auto' });
        try { localStorage.setItem('mainra-admin-tab', name); } catch (e) {}
        if (name === 'analytics') {
            renderAnalyticsTab();
        }
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
        $('#refreshStoreBtn').addEventListener('click', function () { callFunction('sync-playstore'); });
        $('#hideFeaturedBtn').addEventListener('click', hideFeatured);
        $('#exportJsonBtn').addEventListener('click', exportJson);
        
        $('#syncAnalyticsBtn').addEventListener('click', function () {
            var gid = $('#syncAnalyticsBtn').dataset.gid;
            syncTabAnalytics(gid || null);
        });
        $('#analyticsGameFilter').addEventListener('change', renderAnalyticsTab);
        var backBtn = $('#backToOverviewBtn');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                $('#analyticsGameFilter').value = '';
                renderAnalyticsTab();
            });
        }

        $('#rpClose').addEventListener('click', function () { $('#replyModal').close(); });
        $('#rpCancel').addEventListener('click', function () { $('#replyModal').close(); });
        $('#rpSaveDraft').addEventListener('click', saveReplyDraft);
        $('#rpPostGoogle').addEventListener('click', postReplyToGoogle);
        
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
