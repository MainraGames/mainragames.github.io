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

    function hideSplash() {
        var splash = $('#appSplash');
        if (splash) {
            splash.classList.add('is-hidden');
            setTimeout(function () {
                if (splash.parentNode) splash.style.display = 'none';
            }, 350);
        }
    }

    function showShell(user) {
        var loginView = $('#loginView');
        if (loginView) {
            loginView.classList.remove('is-active');
            loginView.style.display = 'none';
        }
        $('#adminShell').classList.add('is-on');
        $('#who').textContent = user.email || 'admin';
        hideSplash();

        // 1. Always load core games, highlight settings, reviews, and unread inbox badge
        loadAll();
        checkInboxBadge();

        // 2. Refresh the currently active tab (social, admins, analytics, etc.)
        var currentTab = 'games';
        try { currentTab = localStorage.getItem('mainra-admin-tab') || 'games'; } catch (e) {}
        selectTab(currentTab);
    }

    function showLogin() {
        $('#adminShell').classList.remove('is-on');
        var loginView = $('#loginView');
        if (loginView) {
            loginView.classList.add('is-active');
            loginView.style.display = 'grid';
        }
        hideSplash();
    }

    async function checkAdmin(user) {
        if (!user) { showLogin(); return; }

        // Fast-path: Show shell immediately with user context
        showShell(user);

        // Verify admin permissions in parallel
        var res = await sb.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
        if (res.error) {
            $('#loginError').textContent = 'DB error: ' + res.error.message;
            $('#loginError').classList.remove('hidden');
            showLogin();
            return;
        }
        if (!res.data) {
            await sb.auth.signOut();
            $('#loginError').textContent = 'This account is not an admin. Ask an existing admin to grant access.';
            $('#loginError').classList.remove('hidden');
            showLogin();
            return;
        }
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
        var tb = $('#gamesTbody');
        if (tb && (!games || !games.length)) {
            tb.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center;padding:1.5rem">Memuat katalog game…</td></tr>';
        }
        var res = await sb.from('games').select('*').order('sort_order', { ascending: true }).order('title');
        if (res.error) { toast('Load games failed: ' + res.error.message, true); return; }
        games = res.data || [];
        renderGamesTable();
        populateGameSelectors();
        renderFeaturedGrid();
        renderAnalyticsTab();
        renderQuickGameChips();
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
        var rgf = $('#reviewGameFilter');
        if (rgf) rgf.innerHTML = '<option value="">All games</option>' + opts;

        renderAnalyticsScopeBar();
    }

    function renderAnalyticsScopeBar() {
        // Render modern segmented pill bar for Analytics
        var scopeBar = $('#analyticsScopeBar');
        if (scopeBar) {
            var currentVal = $('#analyticsGameFilter') ? $('#analyticsGameFilter').value : '';
            var pillsHtml = '<button type="button" class="scope-pill ' + (!currentVal ? 'active' : '') + '" data-scope="" role="tab" aria-selected="' + (!currentVal) + '">' +
                '<span class="scope-icon">📊</span>' +
                '<span>Studio Overview</span>' +
                '<span class="scope-badge" id="scopeAllBadge">' + games.length + ' Games</span>' +
            '</button>';

            pillsHtml += games.map(function (g) {
                var isActive = currentVal === g.id;
                var shortTitle = g.title.split(':')[0].trim();
                var gReviews = reviews.filter(function (r) { return String(r.game_id) === String(g.id); });
                var badgeText = gReviews.length ? gReviews.length : (g.rating != null ? '★' + g.rating : '—');
                return '<button type="button" class="scope-pill ' + (isActive ? 'active' : '') + '" data-scope="' + esc(g.id) + '" role="tab" aria-selected="' + isActive + '" title="' + esc(g.title) + '">' +
                    '<img class="scope-thumb" src="' + esc(icon256(g.image)) + '" alt="" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'">' +
                    '<span>' + esc(shortTitle) + '</span>' +
                    '<span class="scope-badge">' + esc(badgeText) + '</span>' +
                '</button>';
            }).join('');

            scopeBar.innerHTML = pillsHtml;

            $$('[data-scope]').forEach(function (btn) {
                btn.onclick = function () {
                    var scopeId = btn.dataset.scope || '';
                    if ($('#analyticsGameFilter')) $('#analyticsGameFilter').value = scopeId;
                    $$('.scope-pill').forEach(function (p) {
                        var active = (p.dataset.scope || '') === scopeId;
                        p.classList.toggle('active', active);
                        p.setAttribute('aria-selected', active);
                    });
                    renderAnalyticsTab();
                };
            });
        }
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
        var badge = $('#featuredStatusBadge');
        if (!games.length) {
            box.innerHTML = '<div class="muted" style="padding:1rem">Belum ada game. Klik “Refresh Play Store”.</div>';
            if (badge) { badge.className = 'badge warn'; badge.textContent = 'Kosong'; }
            return;
        }
        var currentId = (highlight && highlight.gameId) || '';
        var isActive = !!(highlight && highlight.active);

        if (badge) {
            if (isActive && currentId) {
                var activeGame = games.find(function(x) { return x.id === currentId; });
                badge.className = 'badge ok';
                badge.textContent = 'Aktif: ' + (activeGame ? activeGame.title.split(':')[0] : 'Ya');
            } else {
                badge.className = 'badge warn';
                badge.textContent = 'Nonaktif / Hidden';
            }
        }

        box.innerHTML = games.map(function (g, i) {
            var picked = String(g.id) === String(currentId) && isActive;
            return '<button type="button" class="feat-card' + (picked ? ' picked' : '') + '" data-feat="' + i + '">' +
                '<img class="feat-icon" src="' + esc(icon256(g.image)) + '" alt="" loading="lazy" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'">' +
                '<span class="feat-name">' + esc(g.title) + '</span>' +
                '<span class="feat-meta">' + esc(g.category || '') + (g.rating != null ? ' · ★ ' + esc(g.rating) : '') + '</span>' +
                (picked ? '<span class="badge ok feat-badge">Featured di Web</span>' : '') +
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
        selectTab('games');
        selectGamesSubtab('analytics');
        $('#analyticsGameFilter').value = id || '';
        $$('.scope-pill').forEach(function (p) {
            var active = (p.dataset.scope || '') === (id || '');
            p.classList.toggle('active', active);
            p.setAttribute('aria-selected', active);
        });
        renderAnalyticsTab();
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    function renderAnalyticsTab() {
        // Ensure scope pills are rendered and stay in sync with latest games
        renderAnalyticsScopeBar();

        var id = $('#analyticsGameFilter') ? $('#analyticsGameFilter').value : '';
        if (!id) {
            $('#analyticsOverview').style.display = 'block';
            $('#analyticsSingleGame').style.display = 'none';
            if ($('#syncAnalyticsBtn')) {
                $('#syncAnalyticsBtn').dataset.gid = '';
                $('#syncAnalyticsBtn').textContent = '↻ Sync All from Play Store';
            }
            renderAnalyticsOverview();
        } else {
            $('#analyticsOverview').style.display = 'none';
            $('#analyticsSingleGame').style.display = 'block';
            var g = games.find(function (x) { return x.id === id; });
            if (g) {
                if ($('#syncAnalyticsBtn')) {
                    $('#syncAnalyticsBtn').dataset.gid = g.appId || g.id;
                    $('#syncAnalyticsBtn').textContent = '↻ Sync ' + (g.title.split(':')[0] || 'Game');
                }
                $('#singleGameReviewTitle').textContent = 'Reviews for ' + g.title;
                loadTabAnalytics(g);
                loadTabReviews(g.id);
            }
        }
    }

    var overviewFilterMode = 'all';
    var singleFilterMode = 'all';
    var overviewSearchQuery = '';
    var singleSearchQuery = '';

    function filterReviewItems(items, mode, query) {
        if (!items) return [];
        var result = items;
        if (mode === 'unreplied') {
            result = result.filter(function (r) {
                var txt = (r.reply_text || '').trim();
                return !txt;
            });
        } else if (mode === 'replied') {
            result = result.filter(function (r) {
                var txt = (r.reply_text || '').trim();
                return !!txt;
            });
        } else if (mode === '5star') {
            result = result.filter(function (r) {
                return Number(r.star_rating) === 5;
            });
        } else if (mode === 'critical') {
            result = result.filter(function (r) {
                var s = Number(r.star_rating);
                return s < 5 && s > 0;
            });
        }

        if (query && query.trim()) {
            var q = query.trim().toLowerCase();
            result = result.filter(function (r) {
                var content = (r.content || '').toLowerCase();
                var author = (r.author_name || '').toLowerCase();
                var reply = (r.reply_text || '').toLowerCase();
                var device = (r.device || '').toLowerCase();
                return content.indexOf(q) !== -1 ||
                       author.indexOf(q) !== -1 ||
                       reply.indexOf(q) !== -1 ||
                       device.indexOf(q) !== -1;
            });
        }

        return result;
    }

    function renderDistributionBars(containerId, sentimentBadgeId, reviewList, onStarClick) {
        var counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        var totalRated = 0;
        var positiveCount = 0;

        reviewList.forEach(function (r) {
            var s = Number(r.star_rating);
            if (s >= 1 && s <= 5) {
                counts[s] = (counts[s] || 0) + 1;
                totalRated++;
                if (s >= 4) positiveCount++;
            }
        });

        var sentimentEl = $('#' + sentimentBadgeId);
        if (sentimentEl) {
            if (totalRated === 0) {
                sentimentEl.className = 'sentiment-badge neutral';
                sentimentEl.textContent = 'No Ratings Yet';
            } else {
                var pct = Math.round((positiveCount / totalRated) * 100);
                if (pct >= 80) {
                    sentimentEl.className = 'sentiment-badge positive';
                    sentimentEl.textContent = '👍 ' + pct + '% Positive';
                } else if (pct >= 50) {
                    sentimentEl.className = 'sentiment-badge neutral';
                    sentimentEl.textContent = '⚖️ ' + pct + '% Mixed';
                } else {
                    sentimentEl.className = 'sentiment-badge negative';
                    sentimentEl.textContent = '⚠️ ' + pct + '% Critical';
                }
            }
        }

        var container = $('#' + containerId);
        if (!container) return;

        var html = [5, 4, 3, 2, 1].map(function (star) {
            var c = counts[star] || 0;
            var widthPct = totalRated > 0 ? ((c / totalRated) * 100).toFixed(1) : 0;
            return '<div class="rating-dist-row clickable-dist-row" data-dist-star="' + star + '" title="Click to filter ' + star + '-star reviews">' +
                '<span class="rating-star-lbl">' + star + ' ★</span>' +
                '<div class="rating-bar-track">' +
                    '<div class="rating-bar-fill bar-' + star + '" style="width:' + widthPct + '%"></div>' +
                '</div>' +
                '<span class="rating-bar-count">' + c + '</span>' +
            '</div>';
        }).join('');

        container.innerHTML = html;

        if (onStarClick) {
            container.querySelectorAll('[data-dist-star]').forEach(function (row) {
                row.addEventListener('click', function () {
                    var s = Number(row.dataset.distStar);
                    onStarClick(s);
                });
            });
        }
    }

    function renderLanguageGrid(containerId, countBadgeId, reviewList) {
        var langCounts = {};
        var total = reviewList.length;

        reviewList.forEach(function (r) {
            var l = String(r.lang || 'other').toLowerCase().slice(0, 2);
            langCounts[l] = (langCounts[l] || 0) + 1;
        });

        var entries = Object.keys(langCounts).map(function (k) {
            return { code: k, count: langCounts[k] };
        }).sort(function (a, b) { return b.count - a.count; });

        var countBadge = $('#' + countBadgeId);
        if (countBadge) {
            countBadge.textContent = entries.length + ' language(s)';
        }

        var container = $('#' + containerId);
        if (!container) return;

        if (!entries.length) {
            container.innerHTML = '<div class="muted small">No language data yet</div>';
            return;
        }

        container.innerHTML = entries.map(function (item) {
            var meta = LANG_NAMES[item.code] || { name: item.code.toUpperCase(), flag: '🌐' };
            var pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return '<div class="lang-dist-item">' +
                '<div class="lang-dist-title">' + meta.flag + ' ' + esc(meta.name) + '</div>' +
                '<div class="lang-dist-pct">' + pct + '%</div>' +
                '<div class="lang-dist-count">' + item.count + ' review(s)</div>' +
            '</div>';
        }).join('');
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

        // Render Overview Distribution Bars and Global Language Grid
        renderDistributionBars('overviewRatingBars', 'overviewRatingSentiment', reviews);
        renderLanguageGrid('overviewLangGrid', 'overviewLangCount', reviews);

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
                    var targetId = b.dataset.drilldown;
                    $('#analyticsGameFilter').value = targetId;
                    $$('.scope-pill').forEach(function (p) {
                        var active = (p.dataset.scope || '') === targetId;
                        p.classList.toggle('active', active);
                        p.setAttribute('aria-selected', active);
                    });
                    renderAnalyticsTab();
                });
            });
        }

        // Render Overview Latest Reviews Feed
        var feedBox = $('#overviewLatestReviews');
        if (!reviews.length) {
            feedBox.innerHTML = '<div class="muted">No reviews recorded yet. Click "Sync from Play Store" above to fetch latest reviews.</div>';
            if ($('#overviewFeedCount')) $('#overviewFeedCount').textContent = '0';
        } else {
            function updateOverviewFeed() {
                var filtered = filterReviewItems(reviews, overviewFilterMode, overviewSearchQuery);
                if ($('#overviewFeedCount')) {
                    $('#overviewFeedCount').textContent = filtered.length + ' of ' + reviews.length;
                }

                if (!filtered.length) {
                    var emptyMsg = overviewSearchQuery
                        ? 'Tidak ada ulasan yang cocok dengan pencarian "' + esc(overviewSearchQuery) + '".'
                        : 'No reviews match the current filter (' + esc(overviewFilterMode) + ').';
                    feedBox.innerHTML = '<div class="muted" style="text-align:center;padding:1.8rem">' + emptyMsg + '</div>';
                    return;
                }

                var displayItems = filtered.slice(0, 15);
                feedBox.innerHTML = displayItems.map(function (r, i) {
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
                            getDeviceSpecsBadge(r) +
                            '<button class="btn-admin ghost" style="font-size:.75rem;padding:.2rem .6rem" data-reply-overview="' + i + '" type="button">' +
                                (answered ? '✎ Edit reply' : '↩ Reply') +
                            '</button>' +
                        '</div>' +
                        '<p style="margin:.45rem 0 0;font-size:.92rem;color:var(--mainra-white)">' + esc(r.content || '—') + '</p>' +
                        (hasForeignContent ?
                            '<div>' +
                                '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-lang="' + esc(r.lang || '') + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
                                '<div id="' + transBoxId + '" class="trans-box" style="display:none"></div>' +
                            '</div>' : '') +
                        (answered ? '<p style="margin:.6rem 0 0;padding:.6rem .8rem;border-left:3px solid var(--mainra-success);background:rgba(127,209,161,.06);font-size:.85rem"><span class="muted" style="font-size:.75rem">Mainra replied:</span><br>' + esc(r.reply_text) + '</p>' : '') +
                    '</div>';
                }).join('');

                $$('[data-reply-overview]').forEach(function (btn) {
                    btn.addEventListener('click', function () { openReply(displayItems[Number(btn.dataset.replyOverview)]); });
                });
                wireTranslationButtons();
            }

            updateOverviewFeed();

            // Wire filter chips with onclick handler directly (prevents duplicate listeners)
            $$('#overviewFeedFilters .filter-chip').forEach(function (chip) {
                chip.onclick = function () {
                    $$('#overviewFeedFilters .filter-chip').forEach(function (c) { c.classList.remove('active'); });
                    chip.classList.add('active');
                    overviewFilterMode = chip.dataset.filter;
                    updateOverviewFeed();
                };
            });

            // Wire search input
            var searchInp = $('#overviewReviewSearchInput');
            if (searchInp) {
                searchInp.oninput = function () {
                    overviewSearchQuery = searchInp.value;
                    updateOverviewFeed();
                };
            }

            // Wire star bar clicks to filter overview
            renderDistributionBars('overviewRatingBars', 'overviewRatingSentiment', reviews, function (clickedStar) {
                overviewFilterMode = clickedStar === 5 ? '5star' : 'critical';
                $$('#overviewFeedFilters .filter-chip').forEach(function (c) {
                    c.classList.toggle('active', c.dataset.filter === overviewFilterMode);
                });
                updateOverviewFeed();
                feedBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
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

        // Render Single Game Distribution Bars and Audience Languages
        renderDistributionBars('singleRatingBars', 'singleRatingSentiment', gReviews, function (clickedStar) {
            singleFilterMode = clickedStar === 5 ? '5star' : 'critical';
            $$('#singleFeedFilters .filter-chip').forEach(function (c) {
                c.classList.toggle('active', c.dataset.filter === singleFilterMode);
            });
            loadTabReviews(g.id);
            var box = $('#tabReviewsList');
            if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        renderLanguageGrid('singleLangGrid', 'singleLangCount', gReviews);
    }

    async function loadTabReviews(gameId) {
        var box = $('#tabReviewsList');
        var countBadge = $('#singleFeedCount');
        var res = await sb.from('game_reviews')
            .select('*')
            .eq('game_id', gameId)
            .order('review_timestamp', { ascending: false })
            .limit(50);
        if (res.error) { box.innerHTML = '<div class="muted">Could not load reviews: ' + esc(res.error.message) + '</div>'; return; }
        var allRows = res.data || [];
        if (!allRows.length) {
            box.innerHTML = '<div class="muted" style="margin:0">No reviews synced yet for this title. Click "Sync from Play Store" above to fetch.</div>';
            if (countBadge) countBadge.textContent = '0';
            return;
        }

        var rows = filterReviewItems(allRows, singleFilterMode, singleSearchQuery);
        if (countBadge) countBadge.textContent = rows.length + ' of ' + allRows.length;

        if (!rows.length) {
            var emptyMsg = singleSearchQuery
                ? 'Tidak ada ulasan yang cocok dengan pencarian "' + esc(singleSearchQuery) + '".'
                : 'No reviews match the "' + esc(singleFilterMode) + '" filter.';
            box.innerHTML = '<div class="muted" style="text-align:center;padding:1.5rem">' + emptyMsg + '</div>';
            return;
        }

        box.innerHTML = rows.map(function (r, i) {
            var answered = (r.reply_text || '').trim();
            var transBoxId = 'trans_tab_' + i;
            var hasForeignContent = r.content && r.content.trim() && r.lang !== 'id';

            return '<div class="review-item" data-rvidx="' + i + '" style="border-bottom:1px solid var(--mainra-line);padding:1rem 0">' +
                '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;flex-wrap:wrap">' +
                    '<div>' +
                        '<div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">' +
                            '<strong>' + esc(r.author_name || 'Anonymous') + '</strong>' +
                            ' <span style="color:var(--mainra-gold)">' + starStr(r.star_rating) + '</span>' +
                            ' ' + getLangBadge(r.lang) +
                            (r.review_timestamp ? ' <span class="muted" style="font-size:.85rem">· ' + new Date(r.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        '</div>' +
                        getDeviceSpecsBadge(r) +
                    '</div>' +
                    '<button class="btn-admin ghost" style="font-size:.8rem;padding:.25rem .75rem" data-reply-tab="' + i + '" type="button">' +
                        (answered ? '✎ Edit reply' : '↩ Reply') +
                    '</button>' +
                '</div>' +
                '<p style="margin:.6rem 0 0;font-size:1rem;color:var(--mainra-white)">' + esc(r.content || '—') + '</p>' +
                (hasForeignContent ?
                    '<div>' +
                        '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-lang="' + esc(r.lang || '') + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
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

        // Wire single game filter chips
        $$('#singleFeedFilters .filter-chip').forEach(function (chip) {
            chip.onclick = function () {
                $$('#singleFeedFilters .filter-chip').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                singleFilterMode = chip.dataset.filter;
                loadTabReviews(gameId);
            };
        });

        // Wire single review search input
        var singleSearchInp = $('#singleReviewSearchInput');
        if (singleSearchInp) {
            singleSearchInp.oninput = function () {
                singleSearchQuery = singleSearchInp.value;
                loadTabReviews(gameId);
            };
        }
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

    function getDeviceSpecsBadge(r) {
        var parts = [];
        var dev = r.device_name || r.device;
        if (dev) {
            parts.push('📱 ' + esc(dev));
        }
        if (r.android_os_version) {
            // Android SDK to OS name helper (SDK 34 -> Android 14, 33 -> 13, 32/31 -> 12, etc.)
            var osNames = { 35: '15', 34: '14', 33: '13', 32: '12L', 31: '12', 30: '11', 29: '10', 28: '9 (Pie)', 27: '8.1', 26: '8.0' };
            var osStr = osNames[r.android_os_version] ? 'Android ' + osNames[r.android_os_version] : 'Android SDK ' + r.android_os_version;
            parts.push('🤖 ' + esc(osStr));
        }
        var vName = r.app_version_name || (r.versionCode && !String(r.versionCode).match(/^\d+$/) ? r.versionCode : null);
        var vCode = r.app_version_code || (r.versionCode && String(r.versionCode).match(/^\d+$/) ? r.versionCode : null);
        if (vName || vCode) {
            var vText = '📦 v' + esc(vName || vCode) + (vName && vCode ? ' (' + esc(vCode) + ')' : '');
            parts.push(vText);
        }
        if (r.device_metadata && r.device_metadata.ramMb) {
            var ramGb = Math.round(r.device_metadata.ramMb / 1024);
            parts.push('⚡ ' + (ramGb >= 1 ? ramGb + 'GB RAM' : r.device_metadata.ramMb + 'MB RAM'));
        }
        if (r.thumbs_up_count > 0) {
            parts.push('👍 ' + r.thumbs_up_count);
        }
        if (!parts.length) return '';
        return '<div class="review-specs-line" style="display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; font-size:.76rem; color:var(--admin-text-secondary); margin-top:.35rem;">' +
            parts.map(function (p) {
                return '<span style="background:rgba(255,255,255,0.05); border:1px solid var(--admin-border-subtle); padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:.25rem;">' + p + '</span>';
            }).join('') +
        '</div>';
    }

    var translationCache = {};

    async function translateText(text, targetLang, sourceLang) {
        targetLang = targetLang || 'id';
        var key = (sourceLang || 'auto') + ':' + targetLang + ':' + text;
        if (translationCache[key]) return translationCache[key];

        // 1. Primary Engine: MyMemory Translated API (Reliable, supports Autodetect, Persian, Arabic, English, etc.)
        try {
            var pair = (sourceLang && sourceLang !== 'auto' ? sourceLang : 'Autodetect') + '|' + targetLang;
            var myMemoryUrl = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(pair);
            var res = await fetch(myMemoryUrl);
            if (res.ok) {
                var json = await res.json();
                var trans = json && json.responseData && json.responseData.translatedText;
                var det = (json && json.responseData && json.responseData.detectedLanguage) || sourceLang || '';
                // Normalize detected ISO-639 codes (e.g. 'pes' -> 'fa')
                if (det === 'pes') det = 'fa';
                if (trans && trans.trim() && trans.trim() !== text.trim()) {
                    var result = { text: trans, detectedLang: det };
                    translationCache[key] = result;
                    return result;
                }
            }
        } catch (e1) {
            console.warn('MyMemory translate error:', e1);
        }

        // 2. Secondary Engine: Google GTX Fallback
        try {
            var sl = (sourceLang && sourceLang !== 'auto') ? sourceLang : 'auto';
            var gtxUrl = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(text);
            var gtxRes = await fetch(gtxUrl);
            if (gtxRes.ok) {
                var gData = await gtxRes.json();
                var gTrans = (gData[0] || []).map(function (s) { return s[0]; }).join('');
                var gDet = gData[2] || sourceLang || '';
                if (gTrans && gTrans.trim()) {
                    var gResult = { text: gTrans, detectedLang: gDet };
                    translationCache[key] = gResult;
                    return gResult;
                }
            }
        } catch (e2) {
            console.warn('Google GTX translate error:', e2);
        }

        // 3. Tertiary Engine: Gemini AI Translation (if Gemini API key is configured by admin)
        var savedGeminiKey = localStorage.getItem('mainra-gemini-key');
        if (savedGeminiKey) {
            try {
                var aiRes = await sb.functions.invoke('ai-social-assistant', {
                    body: {
                        action: 'translate',
                        client_gemini_key: savedGeminiKey,
                        text: text,
                        targetLang: targetLang
                    }
                });
                if (aiRes.data && aiRes.data.success && aiRes.data.translatedText) {
                    var aiResult = { text: aiRes.data.translatedText, detectedLang: aiRes.data.detectedLang || sourceLang || '' };
                    translationCache[key] = aiResult;
                    return aiResult;
                }
            } catch (e3) {
                console.warn('AI translate error:', e3);
            }
        }

        return { text: text, detectedLang: sourceLang || '' };
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
                var res = await translateText(originalText, 'id', btn.dataset.transLang);
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
                            (r.device ? ' <span class="muted" style="font-size:.78rem;background:rgba(255,255,255,.05);padding:1px 6px;border-radius:4px;">📱 ' + esc(r.device) + '</span>' : '') +
                            (g ? '<span class="muted" style="font-size:.85rem">· ' + esc(g.title) + '</span>' : '') +
                            (r.review_timestamp ? '<span class="muted" style="font-size:.85rem">· ' + new Date(r.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span>' : '') +
                        '</div>' +
                        (r.device ? '<div class="muted small" style="margin-top:.25rem">' + esc(r.device) + (r.versionCode ? ' · App v' + esc(r.versionCode) : '') + '</div>' : '') +
                        '<p style="margin:.6rem 0 0;font-size:.95rem;line-height:1.45">' + esc(r.content || '—') + '</p>' +
                        (hasForeignContent ?
                            '<div>' +
                                '<button type="button" class="btn-trans" data-trans-btn data-trans-target="' + transBoxId + '" data-trans-lang="' + esc(r.lang || '') + '" data-trans-text="' + esc(r.content) + '">🌐 Terjemahkan ke Indonesia</button>' +
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
            getDeviceSpecsBadge(row) +
            '<div class="muted small" style="margin-top:.3rem;margin-bottom:.5rem">' + esc(gameName) + (row.review_timestamp ? ' · ' + new Date(row.review_timestamp).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' +
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
                    var res = await translateText(row.content, 'id', row.lang);
                    var sName = (LANG_NAMES[res.detectedLang] && LANG_NAMES[res.detectedLang].name) || res.detectedLang || 'Asing';
                    mBox.innerHTML = '<div style="font-size:.76rem;color:var(--mainra-muted);margin-bottom:.25rem">🌐 Diterjemahkan dari ' + esc(sName) + ':</div>' + esc(res.text);
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

        // Wire Presets Buttons
        $('#rpPresets').innerHTML = PRESETS.map(function (p, i) {
            return '<button class="btn ghost small" type="button" data-preset="' + i + '" style="font-size:.78rem;padding:.25rem .55rem">' + esc(p.label) + '</button>';
        }).join('');
        $$('[data-preset]').forEach(function (b) {
            b.addEventListener('click', function () {
                textEl.value = PRESETS[Number(b.dataset.preset)].text;
                updateCount();
            });
        });

        // Wire AI Auto-Localize Reply Button
        var autoLocalizeBtn = $('#rpAutoLocalizeBtn');
        if (autoLocalizeBtn) {
            autoLocalizeBtn.onclick = async function () {
                var playerLang = row.lang || 'id';
                var currentDraft = textEl.value.trim();
                var langMeta = LANG_NAMES[playerLang] || { name: playerLang.toUpperCase() };

                autoLocalizeBtn.disabled = true;
                autoLocalizeBtn.textContent = '✨ Membuat balasan (' + (langMeta.name || playerLang) + ')…';

                try {
                    var apiKey = localStorage.getItem('mainra-gemini-key') || '';
                    var preferredModel = $('#geminiGlobalModelSelect') ? $('#geminiGlobalModelSelect').value : 'gemini-2.5-flash-lite';
                    var res = await sb.functions.invoke('ai-social-assistant', {
                        body: {
                            action: 'localize_reply',
                            client_gemini_key: apiKey,
                            model: preferredModel,
                            reviewText: row.content || '',
                            rating: row.star_rating || 5,
                            playerLang: playerLang,
                            authorName: row.author_name || 'Pemain',
                            gameTitle: gameName,
                            replyDraft: currentDraft
                        }
                    });

                    if (res.error || !res.data || !res.data.success) {
                        var errMsg = (res.data && res.data.message) || (res.error && res.error.message) || 'Gagal menghasilkan balasan AI.';
                        throw new Error(errMsg);
                    }

                    var localizedReply = res.data.localizedReply || '';
                    if (localizedReply) {
                        localizedReply = String(localizedReply).replace(/\s+/g, " ").trim();
                        textEl.value = localizedReply;
                        updateCount();
                        toast('Balasan resmi berhasil disesuaikan ke bahasa ' + (langMeta.name || playerLang) + '! ✓');
                    }
                } catch (err) {
                    toast('Auto-localize gagal: ' + (err.message || err), true);
                } finally {
                    autoLocalizeBtn.disabled = false;
                    autoLocalizeBtn.textContent = '✨ AI Auto-Localize Reply';
                }
            };
        }

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
        var isAnalyticsActive = $('#subtab-analytics') && $('#subtab-analytics').classList.contains('active');
        if (gameId && isAnalyticsActive) {
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
                var errDetail = '';
                if (res.error.context && typeof res.error.context.json === 'function') {
                    try {
                        var errJson = await res.error.context.json();
                        errDetail = errJson.message || '';
                    } catch (_) {}
                }
                var errStr = errDetail || String(res.error.message || res.error);
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
            var isAnalyticsActive = $('#subtab-analytics') && $('#subtab-analytics').classList.contains('active');
            if (gameId && isAnalyticsActive) {
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
            var errDetail = '';
            if (res.error.context && typeof res.error.context.json === 'function') {
                try {
                    var errJson = await res.error.context.json();
                    errDetail = errJson.message || '';
                } catch (_) {}
            }
            var msg = errDetail || String(res.error.message || res.error);
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

    var TITLES = { games: 'Games & Analitik Review', social: 'Social Broadcast', inbox: 'Pesan Masuk (Inbox)', admins: 'Kelola Sistem & Admin' };

    function selectGamesSubtab(subtabName) {
        var validSubtab = subtabName === 'analytics' ? 'analytics' : 'catalog';
        $$('.subtab-btn').forEach(function (btn) {
            var isActive = btn.dataset.subtab === validSubtab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive);
        });
        $$('.subtab-content').forEach(function (content) {
            content.classList.toggle('active', content.id === 'subtab-' + validSubtab);
        });
        try { localStorage.setItem('mainra-games-subtab', validSubtab); } catch (e) {}
        if (validSubtab === 'analytics') {
            renderAnalyticsTab();
        }
    }

    function selectTab(name) {
        if (name === 'featured') name = 'games';
        if (name === 'reviews' || name === 'analytics') {
            name = 'games';
            selectGamesSubtab('analytics');
        }
        $$('.admin-nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
        $('#tabTitle').textContent = TITLES[name] || name;
        window.scrollTo({ top: 0, behavior: 'auto' });
        try { localStorage.setItem('mainra-admin-tab', name); } catch (e) {}
        if (name === 'games') {
            var savedSubtab = 'catalog';
            try { savedSubtab = localStorage.getItem('mainra-games-subtab') || 'catalog'; } catch (e) {}
            selectGamesSubtab(savedSubtab);
        } else if (name === 'social') {
            loadSocialBroadcasts();
            loadBufferProfiles();
            renderQuickGameChips();
            wireSocialTemplates();
            wireImagePasteUploader();
            wireScheduleControls();
            initAiAssistant();
            wireLivePreview();
        } else if (name === 'inbox') {
            loadInboxMessages();
        } else if (name === 'admins') {
            loadAdmins();
            initAiSystemSettings();
        }
    }

    function updateSocialLimitIndicators(len) {
        var postCharCount = $('#postCharCount');
        if (postCharCount) postCharCount.textContent = len + ' / 2200';

        var tagX = $('#charTagX');
        var valX = $('#valTagX');
        var tagTh = $('#charTagThreads');
        var valTh = $('#valTagThreads');
        var tagIg = $('#charTagIg');
        var valIg = $('#valTagIg');
        var tagTt = $('#charTagTiktok');
        var valTt = $('#valTagTiktok');
        var warnLbl = $('#charWarningLabel');

        var remX = 280 - len;
        var remTh = 500 - len;
        var remIg = 2200 - len;
        var remTt = 2200 - len;

        if (valX) valX.textContent = remX >= 0 ? remX : (remX);
        if (tagX) {
            tagX.classList.toggle('is-over', remX < 0);
            tagX.classList.toggle('is-safe', remX >= 0 && len > 0);
        }

        if (valTh) valTh.textContent = remTh >= 0 ? remTh : (remTh);
        if (tagTh) {
            tagTh.classList.toggle('is-over', remTh < 0);
            tagTh.classList.toggle('is-safe', remTh >= 0 && len > 0);
        }

        if (valIg) valIg.textContent = remIg >= 0 ? remIg : (remIg);
        if (tagIg) {
            tagIg.classList.toggle('is-over', remIg < 0);
            tagIg.classList.toggle('is-safe', remIg >= 0 && len > 0);
        }

        if (valTt) valTt.textContent = remTt >= 0 ? remTt : (remTt);
        if (tagTt) {
            tagTt.classList.toggle('is-over', remTt < 0);
            tagTt.classList.toggle('is-safe', remTt >= 0 && len > 0);
        }

        if (warnLbl) {
            if (remX < 0 || remTh < 0) {
                var overList = [];
                if (remX < 0) overList.push('X/Twitter (' + Math.abs(remX) + ' char over)');
                if (remTh < 0) overList.push('Threads (' + Math.abs(remTh) + ' char over)');
                warnLbl.innerHTML = '<span style="color:#f87171">⚠️ Melebihi batas ' + overList.join(', ') + '. Gunakan tombol <b>AI Auto-Fit</b>.</span>';
            } else {
                warnLbl.textContent = len > 0 ? '✓ Aman untuk semua platform yang dipilih.' : '';
            }
        }
    }

    function wireLivePreview() {
        var contentInput = $('#postContent');
        var imgInput = $('#postImage');
        var linkInput = $('#postLink');

        var previewText = $('#previewText');
        var previewImage = $('#previewImage');
        var previewLinkCard = $('#previewLinkCard');
        var previewLinkText = $('#previewLinkText');
        var previewAuthorName = $('#previewAuthorName');
        var previewSubtitle = $('#previewSubtitle');

        var activePlatform = 'facebook';

        function updatePreview() {
            if (previewText) {
                var txt = (contentInput && contentInput.value.trim()) || '';
                previewText.textContent = txt || 'Tulis pesan di sebelah kiri untuk melihat pratinjau langsung postingan media sosial Anda…';
                previewText.style.color = txt ? 'var(--mainra-white)' : 'var(--mainra-muted)';
                updateSocialLimitIndicators(contentInput ? contentInput.value.length : 0);
            }

            if (previewImage) {
                var imgUrl = (imgInput && imgInput.value.trim()) || '';
                if (imgUrl) {
                    previewImage.src = imgUrl;
                    previewImage.style.display = 'block';
                    previewImage.onerror = function () { previewImage.style.display = 'none'; };
                } else {
                    previewImage.style.display = 'none';
                }
            }

            if (previewLinkCard) {
                var lk = (linkInput && linkInput.value.trim()) || '';
                if (lk) {
                    previewLinkCard.style.display = 'flex';
                    if (previewLinkText) previewLinkText.textContent = lk;
                } else {
                    previewLinkCard.style.display = 'none';
                }
            }

            // Adapt preview header styling based on active social platform
            if (previewAuthorName && previewSubtitle) {
                if (activePlatform === 'twitter') {
                    previewAuthorName.textContent = 'Mainra Games';
                    previewSubtitle.textContent = '@MainraGames · Just now';
                } else if (activePlatform === 'threads') {
                    previewAuthorName.textContent = 'mainragames';
                    previewSubtitle.textContent = 'mainragames.com · Just now';
                } else if (activePlatform === 'instagram') {
                    previewAuthorName.textContent = 'mainragames';
                    previewSubtitle.textContent = 'Sponsored / Official Post';
                } else {
                    previewAuthorName.textContent = 'Mainra Games';
                    previewSubtitle.textContent = 'Just now · 🌍 Public';
                }
            }
        }

        // Platform switcher buttons
        $$('.preview-tab-btn').forEach(function (btn) {
            btn.onclick = function () {
                $$('.preview-tab-btn').forEach(function (b) { b.classList.remove('is-active'); });
                btn.classList.add('is-active');
                activePlatform = btn.dataset.platform || 'facebook';
                updatePreview();
            };
        });

        if (contentInput) contentInput.addEventListener('input', updatePreview);
        if (imgInput) imgInput.addEventListener('input', updatePreview);
        if (linkInput) linkInput.addEventListener('input', updatePreview);

        updatePreview();
    }

    function renderQuickGameChips() {
        var box = $('#quickGameChips');
        if (!box) return;
        if (!games.length) {
            box.innerHTML = '<div class="muted small">Belum ada game dimuat.</div>';
            return;
        }

        box.innerHTML = games.map(function (g) {
            return '<button type="button" class="game-chip-btn" data-share-game="' + esc(g.id) + '">' +
                '<img src="' + esc(icon256(g.image)) + '" alt="" onerror="this.src=\'../Assets/img/LogoMainraGames.png\'">' +
                '<span>' + esc(g.title.split(':')[0]) + '</span>' +
            '</button>';
        }).join('');

        $$('[data-share-game]').forEach(function (btn) {
            btn.onclick = function () {
                $$('.game-chip-btn').forEach(function (b) { b.classList.remove('is-active'); });
                btn.classList.add('is-active');

                var gid = btn.dataset.shareGame;
                var g = games.find(function (x) { return x.id === gid; });
                if (!g) return;

                var titleInput = $('#postTitle');
                var contentInput = $('#postContent');
                var linkInput = $('#postLink');
                var imgInput = $('#postImage');

                var shortTitle = g.title.split(':')[0].trim();
                var playLink = g.playLink || ('https://play.google.com/store/apps/details?id=' + g.id);

                titleInput.value = 'Update Terbaru: ' + shortTitle;
                linkInput.value = playLink;
                if (g.image) imgInput.value = g.image;

                contentInput.value = '🎮 ' + shortTitle + ' kini hadir dengan konten & update seru!\n\n' +
                    (g.description ? g.description.slice(0, 160) + '…\n\n' : '') +
                    '📲 Unduh gratis di Google Play: ' + playLink + '\n#MainraGames #IndieGame #AndroidGames';

                $('#postCharCount').textContent = contentInput.value.length + ' / 1000';
                wireLivePreview();
                toast('Game “' + shortTitle + '” dipilih! ⚡');
            };
        });
    }

    function wireSocialTemplates() {
        $$('.template-btn').forEach(function (btn) {
            btn.onclick = function () {
                var tmpl = btn.dataset.tmpl;
                var contentInput = $('#postContent');
                var titleInput = $('#postTitle');
                var link = $('#postLink').value.trim() || 'https://mainragames.com';
                var gameTitle = titleInput.value.replace('Update Terbaru: ', '').trim() || 'Game Mainra Games';

                if (tmpl === 'update') {
                    contentInput.value = '🚀 Update Terbaru Rilis!\n\nKami baru saja meluncurkan versi terbaru untuk ' + gameTitle + '. Nikmati peningkatan performa, perbaikan bug, dan pengalaman bermain yang lebih seru!\n\nCek sekarang di: ' + link + '\n#MainraGames #GameUpdate #IndieDev';
                } else if (tmpl === 'milestone') {
                    contentInput.value = '🎉 Terima Kasih Komunitas!\n\n' + gameTitle + ' terus bertumbuh berkat dukungan luar biasa dari kalian semua. Jangan ragu untuk memberikan ulasan dan saran fitur selanjutnya di Play Store!\n\nMainkan di sini: ' + link + '\n#MainraGames #GamerCommunity #ThankYou';
                } else if (tmpl === 'promo') {
                    contentInput.value = '🕹️ Lagi cari game seru untuk mengisi waktu luang?\n\nCobain ' + gameTitle + ' sekarang! Ringan, adiktif, dan cocok dimainkan kapan saja.\n\n📲 Unduh gratis di Google Play: ' + link + '\n#MainraGames #MobileGaming #GameSeru';
                }

                $('#postCharCount').textContent = contentInput.value.length + ' / 1000';
                wireLivePreview();
                toast('Template ' + btn.textContent + ' diterapkan! ✓');
            };
        });
    }

    /* ---------- Gemini AI System Configuration (in Kelola & Admin) ---------- */

    async function initAiSystemSettings() {
        var keyInput = $('#geminiApiKeyInput');
        var testBtn = $('#testGeminiBtn');
        var saveKeyBtn = $('#saveGeminiKeyBtn');
        var refreshModelsBtn = $('#refreshMasterAiModelsBtn');
        var fb = $('#geminiTestFeedback');
        var modelSelect = $('#geminiGlobalModelSelect');
        var masterBadge = $('#geminiMasterStatusBadge');

        if (!keyInput) return;

        // 1. Auto-load existing key from database or localStorage
        var localKey = '';
        try { localKey = localStorage.getItem('mainra-gemini-key') || ''; } catch (e) {}
        var activeKey = localKey;

        if (!activeKey) {
            var dbRes = await sb.from('site_settings').select('value').eq('key', 'gemini_api_key').maybeSingle();
            if (dbRes.data && dbRes.data.value) {
                var v = dbRes.data.value;
                activeKey = typeof v === 'string' ? v : (v.key || '');
            }
        }

        if (activeKey) {
            keyInput.value = activeKey;
            try { localStorage.setItem('mainra-gemini-key', activeKey); } catch (e) {}
            if (masterBadge) {
                masterBadge.textContent = 'Terkoneksi';
                masterBadge.className = 'badge ok';
            }
            await fetchModels(true);
        } else {
            if (masterBadge) {
                masterBadge.textContent = 'Belum Dikonfigurasi';
                masterBadge.className = 'badge warn';
            }
        }

        async function fetchModels(quiet) {
            var currentKey = keyInput ? keyInput.value.trim() : '';
            if (refreshModelsBtn) refreshModelsBtn.textContent = '⏳';

            var res = await sb.functions.invoke('ai-social-assistant', {
                body: { action: 'list_models', client_gemini_key: currentKey }
            }).catch(function (e) { return { error: e }; });

            if (refreshModelsBtn) refreshModelsBtn.textContent = '🔄';

            if (res.error || !res.data || !res.data.models || !res.data.models.length) {
                if (!quiet) {
                    var errMsg = (res.error && res.error.message) || (res.data && res.data.message) || 'Gagal mengambil daftar model.';
                    toast(errMsg, true);
                }
                return;
            }

            var models = res.data.models;
            var currentVal = modelSelect ? modelSelect.value : 'gemini-2.5-flash';

            if (modelSelect) {
                modelSelect.innerHTML = models.map(function (m) {
                    var label = m.displayName || m.id;
                    if (m.id === 'gemini-2.5-flash') label += ' ★ Rekomendasi Utama';
                    else if (m.id === 'gemini-3.8-flash') label += ' (Terbaru)';
                    else if (m.id === 'gemini-3.7-flash') label += ' (Intelligence)';
                    return '<option value="' + esc(m.id) + '">' + esc(label) + '</option>';
                }).join('');

                if (currentVal && models.some(function (m) { return m.id === currentVal; })) {
                    modelSelect.value = currentVal;
                } else if (models.some(function (m) { return m.id === 'gemini-2.5-flash'; })) {
                    modelSelect.value = 'gemini-2.5-flash';
                }
            }

            if (!quiet) {
                toast(models.length + ' model Gemini terbaru berhasil dimuat! ✓');
            }
        }

        if (refreshModelsBtn) {
            refreshModelsBtn.onclick = function () { fetchModels(false); };
        }

        if (testBtn) {
            testBtn.onclick = async function () {
                var apiKey = keyInput ? keyInput.value.trim() : '';
                var model = modelSelect ? modelSelect.value : 'gemini-2.5-flash';
                if (!apiKey) {
                    toast('Mohon masukkan Gemini API Key terlebih dahulu.', true);
                    return;
                }

                testBtn.disabled = true;
                testBtn.textContent = 'Menguji…';
                if (fb) {
                    fb.style.display = 'block';
                    fb.textContent = 'Menghubungi Google Gemini API (' + model + ')…';
                    fb.style.color = 'var(--mainra-muted)';
                }

                var res = await sb.functions.invoke('ai-social-assistant', {
                    body: { action: 'test', client_gemini_key: apiKey, model: model }
                }).catch(function (e) { return { error: e }; });

                testBtn.disabled = false;
                testBtn.textContent = '⚡ Uji Koneksi API';

                if (res.error) {
                    var errorDetail = '';
                    if (res.error.context && typeof res.error.context.json === 'function') {
                        try {
                            var errBody = await res.error.context.json();
                            errorDetail = errBody.message || '';
                        } catch (_) {}
                    }
                    var errTxt = errorDetail || res.error.message || String(res.error);
                    if (fb) {
                        fb.style.display = 'block';
                        fb.textContent = '❌ Gagal: ' + errTxt;
                        fb.style.color = '#f87171';
                    }
                    if (masterBadge) {
                        masterBadge.textContent = 'Error Koneksi';
                        masterBadge.className = 'badge danger';
                    }
                    toast('Uji coba koneksi API gagal.', true);
                    return;
                }

                var msg = (res.data && res.data.message) || 'Koneksi Sukses!';
                if (fb) {
                    fb.style.display = 'block';
                    fb.textContent = '✓ ' + msg;
                    fb.style.color = 'var(--mainra-success)';
                }
                if (masterBadge) {
                    masterBadge.textContent = 'Terkoneksi';
                    masterBadge.className = 'badge ok';
                }
                toast('Koneksi model ' + model + ' valid! ✓');
                fetchModels(true);
            };
        }

        if (saveKeyBtn) {
            saveKeyBtn.onclick = async function () {
                var apiKey = keyInput ? keyInput.value.trim() : '';
                if (!apiKey) {
                    toast('Isi API key sebelum menyimpan.', true);
                    return;
                }

                saveKeyBtn.disabled = true;
                saveKeyBtn.textContent = 'Menyimpan…';

                try { localStorage.setItem('mainra-gemini-key', apiKey); } catch (e) {}

                var res = await sb.functions.invoke('ai-social-assistant', {
                    body: { action: 'save_key', newKey: apiKey }
                }).catch(function (e) { return { error: e }; });

                saveKeyBtn.disabled = false;
                saveKeyBtn.textContent = '💾 Simpan ke Sistem';

                if (res.error) {
                    toast('Gagal menyimpan key: ' + (res.error.message || res.error), true);
                    return;
                }

                if (masterBadge) {
                    masterBadge.textContent = 'Terkoneksi';
                    masterBadge.className = 'badge ok';
                }
                toast('Gemini API Key berhasil disimpan & siap digunakan semua fungsi! ✓');
                fetchModels(true);
            };
        }
    }

    /* ---------- Gemini AI Social Assistant (In Broadcast Composer) ---------- */

    async function initAiAssistant() {
        var openBtn = $('#openAiAssistantBtn');
        var closeBtn = $('#closeAiPanelBtn');
        var panel = $('#aiAssistantPanel');
        var statusDot = $('#geminiConnectionStatusDot');
        var generateBtn = $('#generateAiPostBtn');
        var refreshModelsBtn = $('#refreshAiModelsBtn');
        var modelSelect = $('#aiModelSelect');
        var goToSettingsLink = $('#goToAiSettingsLink');

        if (!panel) return;

        if (goToSettingsLink) {
            goToSettingsLink.onclick = function () {
                selectTab('admins');
            };
        }

        async function syncKeyStatusAndModels() {
            var activeKey = '';
            try { activeKey = localStorage.getItem('mainra-gemini-key') || ''; } catch (e) {}
            if (!activeKey) {
                var dbRes = await sb.from('site_settings').select('value').eq('key', 'gemini_api_key').maybeSingle();
                if (dbRes.data && dbRes.data.value) {
                    var v = dbRes.data.value;
                    activeKey = typeof v === 'string' ? v : (v.key || '');
                }
            }
            if (statusDot) {
                statusDot.style.background = activeKey ? '#7fd1a1' : '#f87171';
                statusDot.title = activeKey ? 'Gemini API Siap' : 'API Key Belum Disetting';
            }
            if (activeKey) {
                fetchDynamicModels(true, activeKey);
            }
        }

        syncKeyStatusAndModels();

        async function fetchDynamicModels(quiet, keyOverride) {
            var apiKey = keyOverride || localStorage.getItem('mainra-gemini-key') || '';
            if (refreshModelsBtn) refreshModelsBtn.textContent = '⏳';

            var res = await sb.functions.invoke('ai-social-assistant', {
                body: { action: "list_models", client_gemini_key: apiKey }
            }).catch(function (e) { return { error: e }; });

            if (refreshModelsBtn) refreshModelsBtn.textContent = '🔄';

            if (res.error || !res.data || !res.data.models || !res.data.models.length) {
                if (!quiet) {
                    var errMsg = (res.error && res.error.message) || (res.data && res.data.message) || 'Gagal mengambil daftar model.';
                    toast(errMsg, true);
                }
                return;
            }

            var currentVal = modelSelect ? modelSelect.value : 'gemini-2.5-flash';
            var models = res.data.models;

            if (modelSelect) {
                modelSelect.innerHTML = models.map(function (m) {
                    var label = m.displayName || m.id;
                    if (m.id === 'gemini-2.5-flash') label += ' ★ Stabil & Cepat';
                    else if (m.id === 'gemini-3.8-flash') label += ' (Terbaru)';
                    else if (m.id === 'gemini-3.7-flash') label += ' (High Intelligence)';
                    return '<option value="' + esc(m.id) + '">' + esc(label) + '</option>';
                }).join('');

                if (currentVal && models.some(function (m) { return m.id === currentVal; })) {
                    modelSelect.value = currentVal;
                } else if (models.some(function (m) { return m.id === 'gemini-2.5-flash'; })) {
                    modelSelect.value = 'gemini-2.5-flash';
                }
            }
        }

        if (refreshModelsBtn) {
            refreshModelsBtn.onclick = function () {
                fetchDynamicModels(false);
            };
        }

        if (openBtn) {
            openBtn.onclick = function () {
                var isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? 'block' : 'none';
                openBtn.textContent = isHidden ? '✕ Tutup AI' : '✨ AI Writer';
                if (isHidden) {
                    syncKeyStatusAndModels();
                }
            };
        }

        if (closeBtn) {
            closeBtn.onclick = function () {
                panel.style.display = 'none';
                if (openBtn) openBtn.textContent = '✨ AI Writer';
            };
        }

        if (generateBtn) {
            generateBtn.onclick = async function () {
                var apiKey = localStorage.getItem('mainra-gemini-key') || '';
                var model = modelSelect ? modelSelect.value : 'gemini-2.5-flash';
                var tone = $('#aiToneSelect') ? $('#aiToneSelect').value : '';
                var customPrompt = $('#aiCustomInstruction') ? $('#aiCustomInstruction').value.trim() : '';
                var titleVal = $('#postTitle') ? $('#postTitle').value.trim() : '';
                var linkVal = $('#postLink') ? $('#postLink').value.trim() : '';

                generateBtn.disabled = true;
                generateBtn.textContent = '✨ Sedang Mengarang Konten…';

                var res = await sb.functions.invoke('ai-social-assistant', {
                    body: {
                        action: "generate",
                        client_gemini_key: apiKey,
                        model: model,
                        tone: tone,
                        gameTitle: titleVal || 'Game Mainra Games',
                        targetLink: linkVal || 'https://mainragames.com',
                        customPrompt: customPrompt
                    }
                }).catch(function (e) { return { error: e }; });

                generateBtn.disabled = false;
                generateBtn.textContent = '✨ Generate Postingan Otomatis';

                if (res.error) {
                    var errorDetail = '';
                    if (res.error.context && typeof res.error.context.json === 'function') {
                        try {
                            var errBody = await res.error.context.json();
                            errorDetail = errBody.message || '';
                        } catch (_) {}
                    }
                    var msg = errorDetail || res.error.message || String(res.error);
                    toast('AI Error: ' + msg, true);
                    return;
                }

                var data = res.data && res.data.result;
                if (data) {
                    var titleInput = $('#postTitle');
                    var contentInput = $('#postContent');

                    var finalTitle = (data.title || '').trim();
                    var finalCaption = (data.caption || '').trim();

                    if (finalCaption.startsWith('{') && finalCaption.includes('"caption"')) {
                        try {
                            var innerParsed = JSON.parse(finalCaption);
                            if (innerParsed.title && !finalTitle) finalTitle = innerParsed.title;
                            if (innerParsed.caption) finalCaption = innerParsed.caption;
                        } catch (e) {
                            var capMatch = finalCaption.match(/"caption"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
                            var titMatch = finalCaption.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
                            if (capMatch) {
                                try { finalCaption = JSON.parse('"' + capMatch[1] + '"'); } catch (_) { finalCaption = capMatch[1]; }
                            }
                            if (titMatch && !finalTitle) {
                                try { finalTitle = JSON.parse('"' + titMatch[1] + '"'); } catch (_) { finalTitle = titMatch[1]; }
                            }
                        }
                    }

                    if (finalTitle && titleInput) {
                        titleInput.value = finalTitle;
                    }
                    if (finalCaption && contentInput) {
                        contentInput.value = finalCaption;
                        wireLivePreview();
                    }
                    toast('Postingan dibuat dengan model ' + (res.data.modelUsed || model) + '! ✨');
                }
            };
        }

        // AI Auto-Fit / Adaptive Limiter logic
        var autoFitBtn = $('#aiAutoFitBtn');
        if (autoFitBtn) {
            autoFitBtn.onclick = async function () {
                var contentInput = $('#postContent');
                var currentTxt = contentInput ? contentInput.value.trim() : '';
                if (!currentTxt) {
                    toast('Tulis atau generate caption terlebih dahulu sebelum disesuaikan.', true);
                    return;
                }

                // Check which channels are currently checked to determine strictness
                var checkedChannels = Array.from($$('#bufferChannelsList input[type="checkbox"]:checked')).map(function (cb) {
                    var label = cb.closest('.channel-select-pill');
                    return label ? label.textContent.toLowerCase() : '';
                });

                var hasX = checkedChannels.some(function (c) { return c.includes('twitter') || c.includes('x'); });
                var hasThreads = checkedChannels.some(function (c) { return c.includes('threads'); });

                var targetLimit = 280;
                var targetPlatform = 'Twitter/X (280 karakter)';

                if (hasX) {
                    targetLimit = 280;
                    targetPlatform = 'Twitter/X (280 karakter)';
                } else if (hasThreads) {
                    targetLimit = 500;
                    targetPlatform = 'Threads (500 karakter)';
                } else {
                    targetLimit = 280;
                    targetPlatform = 'Twitter/X & Threads';
                }

                if (currentTxt.length <= targetLimit) {
                    toast('Teks saat ini (' + currentTxt.length + ' char) sudah memenuhi batas ' + targetPlatform + '! ✓');
                    return;
                }

                var apiKey = keyInput ? keyInput.value.trim() : '';
                var model = modelSelect ? modelSelect.value : 'gemini-3.8-flash';

                autoFitBtn.disabled = true;
                autoFitBtn.innerHTML = '<span>⏳ Memadatkan teks…</span>';

                var res = await sb.functions.invoke('ai-social-assistant', {
                    body: {
                        action: "adapt_limits",
                        client_gemini_key: apiKey,
                        model: model,
                        text: currentTxt,
                        targetLimit: targetLimit,
                        platform: targetPlatform
                    }
                }).catch(function (e) { return { error: e }; });

                autoFitBtn.disabled = false;
                autoFitBtn.innerHTML = '<span>✨ AI Sesuaikan Format Platform</span>';

                if (res.error) {
                    var errorDetail = '';
                    if (res.error.context && typeof res.error.context.json === 'function') {
                        try {
                            var errBody = await res.error.context.json();
                            errorDetail = errBody.message || '';
                        } catch (_) {}
                    }
                    var msg = errorDetail || res.error.message || String(res.error);
                    toast('Gagal menyesuaikan teks: ' + msg, true);
                    return;
                }

                if (res.data && res.data.caption) {
                    var cleanedCap = res.data.caption;
                    // Extra frontend guard against any JSON bracket debris
                    if (cleanedCap.startsWith('{') && cleanedCap.includes('"caption"')) {
                        try {
                            var p = JSON.parse(cleanedCap);
                            if (p.caption) cleanedCap = p.caption;
                        } catch (_) {
                            var m = cleanedCap.match(/"caption"\s*:\s*"([\s\S]+)/i);
                            if (m) cleanedCap = m[1].replace(/"\s*\}?\s*$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
                        }
                    }
                    contentInput.value = cleanedCap.trim();
                    wireLivePreview();
                    toast('Caption dipadatkan menjadi ' + contentInput.value.length + ' karakter untuk ' + targetPlatform + '! ✓');
                }
            };
        }
    }

    /* ---------- load social broadcasts and buffer profiles ---------- */

    var bufferProfiles = [];
    var broadcastsList = [];

    /* ---------- Authentic Brand SVG Icons ---------- */
    function getPlatformBrandIcon(service) {
        var s = (service || '').toLowerCase();
        if (s === 'facebook') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
        }
        if (s === 'twitter' || s === 'x') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
        }
        if (s === 'instagram') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="none"><path fill="url(#igGrad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/><defs><radialGradient id="igGrad" cx="0.2" cy="1" r="1"><stop offset="0%" stop-color="#FFD600"/><stop offset="25%" stop-color="#FF0100"/><stop offset="50%" stop-color="#D800B9"/><stop offset="100%" stop-color="#7000FF"/></radialGradient></defs></svg>';
        }
        if (s === 'threads') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="#FFFFFF"><path d="M12.186 24h-.007C5.46 23.978 0 18.528 0 11.815 0 5.097 5.463-.356 12.186-.356h.007c4.61 0 8.572 2.502 10.495 6.467a.972.972 0 0 1-.462 1.306.97.97 0 0 1-1.307-.463c-1.637-3.376-5.011-5.508-8.726-5.508h-.006c-5.727 0-10.384 4.652-10.384 10.369 0 5.717 4.657 10.369 10.384 10.369h.006c3.488 0 6.643-1.854 8.232-4.839.231-.435.772-.598 1.206-.367.435.231.597.771.367 1.206-1.867 3.504-5.57 5.682-9.807 5.682v-.052zM12 5.568c-3.623 0-6.262 2.768-6.262 6.574 0 3.795 2.628 6.554 6.262 6.554 2.879 0 4.887-1.748 5.419-4.295.143-.687-.272-1.341-.958-1.484-.688-.146-1.342.271-1.485.958-.337 1.616-1.579 2.977-2.976 2.977-2.428 0-4.417-1.921-4.417-4.708 0-2.798 1.999-4.729 4.417-4.729 2.051 0 3.864 1.373 4.298 3.255.084.364-.029.742-.298 1.002-.27.26-.653.379-1.018.315-.811-.141-1.319-.684-1.523-1.628-.095-.443-.53-.726-.974-.632-.444.095-.726.53-.631.974.341 1.583 1.284 2.684 2.795 2.946.33.058.665.034.99-.071 1.018-.333 1.761-1.196 1.99-2.298.669-3.238-1.828-5.75-4.63-5.75z"/></svg>';
        }
        if (s === 'youtube') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
        }
        if (s === 'tiktok') {
            return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="#00F2FE"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.29 0 .58.04.86.12V9.42a6.34 6.34 0 0 0-.86-.06 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 10.79 4.48 6.27 6.27 0 0 0 2.05-4.48V8.65a8.16 8.16 0 0 0 4.61 1.44V6.69z"/></svg>';
        }
        return '<svg class="platform-brand-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>';
    }

    async function loadBufferProfiles() {
        var box = $('#bufferChannelsList');
        var badge = $('#bufferStatusBadge');
        if (!box) return;

        var res = await sb.functions.invoke('sync-buffer', {
            body: { action: 'get_profiles' }
        }).catch(function (e) { return { error: e }; });

        if (res.error || (res.data && res.data.configured === false)) {
            if (badge) {
                badge.className = 'badge warn';
                badge.textContent = 'Token Belum Ada';
            }
            box.innerHTML = '<div class="muted small" style="line-height:1.4">' +
                'Belum terhubung ke Buffer. Masukkan Access Token di Supabase Secret <code>BUFFER_ACCESS_TOKEN</code>.<br>' +
                '<span style="color:var(--mainra-orange)">Postingan tetap tersimpan di database CMS website.</span>' +
            '</div>';
            return;
        }

        var data = res.data || {};
        bufferProfiles = data.profiles || [];

        if (!bufferProfiles.length) {
            if (badge) { badge.className = 'badge warn'; badge.textContent = '0 Channel'; }
            box.innerHTML = '<div class="muted small">Tidak ada profil sosial media yang terhubung di Buffer.</div>';
            return;
        }

        if (badge) {
            badge.className = 'badge ok';
            badge.textContent = bufferProfiles.length + ' Channel Aktif';
        }

        box.innerHTML = bufferProfiles.map(function (p) {
            var s = (p.service || '').toLowerCase();
            var icon = getPlatformBrandIcon(s);

            return '<label class="channel-select-pill is-checked" title="' + esc(p.account_email || '') + '">' +
                '<input type="checkbox" name="buffer_profile" value="' + esc(p.id) + '" checked> ' +
                '<span>' + icon + ' ' + esc(p.formatted_service || p.service) + '</span>' +
            '</label>';
        }).join('');

        $$('#bufferChannelsList input[type="checkbox"]').forEach(function (cb) {
            cb.onchange = function () {
                var label = cb.closest('.channel-select-pill');
                if (label) label.classList.toggle('is-checked', cb.checked);
            };
        });

        var selectAllBtn = $('#selectAllChannelsBtn');
        if (selectAllBtn) {
            selectAllBtn.onclick = function () {
                $$('#bufferChannelsList input[type="checkbox"]').forEach(function (cb) {
                    cb.checked = true;
                    var label = cb.closest('.channel-select-pill');
                    if (label) label.classList.add('is-checked');
                });
            };
        }

        var clearBtn = $('#clearChannelsBtn');
        if (clearBtn) {
            clearBtn.onclick = function () {
                $$('#bufferChannelsList input[type="checkbox"]').forEach(function (cb) {
                    cb.checked = false;
                    var label = cb.closest('.channel-select-pill');
                    if (label) label.classList.remove('is-checked');
                });
            };
        }
    }

    var broadcastFilterMode = 'all'; // 'all', 'scheduled', 'published'

    function renderBroadcastHistoryFeed() {
        var box = $('#broadcastHistoryList');
        var countBadge = $('#broadcastHistoryCount');
        if (!box) return;

        var filtered = broadcastsList.filter(function (b) {
            if (broadcastFilterMode === 'scheduled') return b.status === 'scheduled';
            if (broadcastFilterMode === 'published') return b.status === 'published';
            return true;
        });

        if (countBadge) countBadge.textContent = filtered.length + ' post';

        if (!filtered.length) {
            var emptyMsg = broadcastFilterMode === 'scheduled'
                ? 'Belum ada postingan yang dijadwalkan tayang.'
                : (broadcastFilterMode === 'published'
                    ? 'Belum ada postingan yang telah terbit.'
                    : 'Belum ada riwayat broadcast. Buat postingan pertama Anda!');
            box.innerHTML = '<div class="muted" style="text-align:center; padding:1.5rem">' + esc(emptyMsg) + '</div>';
            return;
        }

        box.innerHTML = filtered.map(function (b) {
            var isScheduled = b.status === 'scheduled';
            var timeRaw = isScheduled ? (b.scheduled_at || b.published_at) : b.published_at;
            var dateStr = timeRaw ? new Date(timeRaw).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
            var channelsCount = Array.isArray(b.channels) ? b.channels.length : 0;
            var updates = Array.isArray(b.buffer_updates) ? b.buffer_updates : [];
            var okCount = updates.filter(function (u) { return u.status === 'success'; }).length;

            var channelPills = updates.map(function (u) {
                var s = (u.service || '').toLowerCase();
                var icon = getPlatformBrandIcon(s);
                var isOk = u.status === 'success';
                var tip = isOk ? (isScheduled ? 'Terjadwal di ' + s : 'Terbit: ' + (u.char_count || '') + ' char') : (u.message || 'Gagal');
                return '<span class="char-tag ' + (isOk ? 'is-safe' : 'is-over') + '" title="' + esc(tip) + '">' +
                    icon + ' ' + (isOk ? '✓' : '✗') +
                '</span>';
            }).join(' ');

            return '<div style="border-bottom:1px solid var(--admin-border-subtle); padding:1rem 0;">' +
                '<div style="display:flex; justify-content:space-between; align-items:baseline; gap:.5rem; flex-wrap:wrap;">' +
                    '<div style="display:flex; align-items:center; gap:.4rem;">' +
                        (isScheduled ? '<span class="badge warn" style="font-size:.68rem">🕒 Jadwal: ' + esc(dateStr) + '</span>' : '') +
                        '<h4 style="margin:0; font-size:.98rem; color:var(--mainra-white)">' + esc(b.title) + '</h4>' +
                    '</div>' +
                    '<span class="muted" style="font-size:.78rem">' + (isScheduled ? 'Antrean Buffer' : esc(dateStr)) + '</span>' +
                '</div>' +
                '<p style="margin:.5rem 0 .4rem; font-size:.88rem; line-height:1.45; color:var(--mainra-ink)">' + esc(b.content) + '</p>' +
                (b.image_url ? '<div style="margin:.4rem 0;"><img src="' + esc(b.image_url) + '" alt="" style="max-height:120px; border-radius:var(--radius-sm); border:1px solid var(--mainra-line);" onerror="this.style.display=\'none\'"></div>' : '') +
                '<div style="display:flex; gap:.6rem; align-items:center; margin-top:.4rem; flex-wrap:wrap;">' +
                    (isScheduled
                        ? '<span class="badge warn" style="font-size:.72rem">🕒 Antrean Kalender</span>'
                        : '<span class="badge ok" style="font-size:.72rem">Web Published</span>') +
                    (channelsCount > 0
                        ? '<span class="badge ' + (okCount > 0 ? 'ok' : 'warn') + '" style="font-size:.72rem">🚀 ' + okCount + '/' + channelsCount + ' Channel ' + (isScheduled ? 'Terjadwal' : 'Terkirim') + '</span>'
                        : '<span class="badge warn" style="font-size:.72rem">Web Only</span>') +
                    (channelPills ? '<div style="display:inline-flex; gap:.25rem; align-items:center">' + channelPills + '</div>' : '') +
                    (b.target_link ? '<a href="' + esc(b.target_link) + '" target="_blank" rel="noopener" style="font-size:.78rem; color:var(--mainra-orange); margin-left:auto">Buka Link ↗</a>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    async function loadSocialBroadcasts() {
        var box = $('#broadcastHistoryList');
        if (!box) return;

        box.innerHTML = '<div class="muted">Memuat riwayat pengumuman & kalender…</div>';

        var res = await sb.from('social_broadcasts')
            .select('*')
            .order('scheduled_at', { ascending: false, nullsFirst: false })
            .order('published_at', { ascending: false })
            .limit(30);

        if (res.error) {
            box.innerHTML = '<div class="muted">Gagal memuat riwayat: ' + esc(res.error.message) + '</div>';
            return;
        }

        broadcastsList = res.data || [];
        renderBroadcastHistoryFeed();

        // Wire filter buttons
        var btnAll = $('#filterBroadcastAllBtn');
        var btnSched = $('#filterBroadcastScheduledBtn');
        var btnPub = $('#filterBroadcastPublishedBtn');

        if (btnAll) btnAll.onclick = function () {
            broadcastFilterMode = 'all';
            $$('#tab-social .filter-chip').forEach(function (c) { c.classList.remove('active'); });
            btnAll.classList.add('active');
            renderBroadcastHistoryFeed();
        };

        if (btnSched) btnSched.onclick = function () {
            broadcastFilterMode = 'scheduled';
            $$('#tab-social .filter-chip').forEach(function (c) { c.classList.remove('active'); });
            btnSched.classList.add('active');
            renderBroadcastHistoryFeed();
        };

        if (btnPub) btnPub.onclick = function () {
            broadcastFilterMode = 'published';
            $$('#tab-social .filter-chip').forEach(function (c) { c.classList.remove('active'); });
            btnPub.classList.add('active');
            renderBroadcastHistoryFeed();
        };
    }

    var isScheduleMode = false;

    function wireImagePasteUploader() {
        var zone = $('#imagePasteZone');
        var fileInput = $('#postImageFileInput');
        var urlInput = $('#postImage');
        var promptBox = $('#imagePastePrompt');
        var previewBox = $('#imagePastePreviewBox');
        var thumb = $('#imagePasteThumb');
        var statusEl = $('#imagePasteStatus');
        var metaEl = $('#imagePasteMeta');
        var removeBtn = $('#removePastedImageBtn');
        var broadcastForm = $('#socialBroadcastForm');

        if (!zone) return;

        function setUploading(isUploading, name, previewDataUrl) {
            if (isUploading) {
                if (promptBox) promptBox.style.display = 'none';
                if (previewBox) previewBox.style.display = 'flex';
                if (thumb && previewDataUrl) thumb.src = previewDataUrl;
                if (statusEl) {
                    statusEl.textContent = 'Mengupload ke CDN…';
                    statusEl.style.color = 'var(--mainra-orange)';
                }
                if (metaEl) metaEl.textContent = name || '';
                zone.style.borderColor = 'var(--mainra-orange)';
            }
        }

        function setSuccess(url, name) {
            if (promptBox) promptBox.style.display = 'none';
            if (previewBox) previewBox.style.display = 'flex';
            if (thumb) thumb.src = url;
            if (statusEl) {
                statusEl.textContent = '✓ Gambar Siap Digunakan';
                statusEl.style.color = 'var(--mainra-success)';
            }
            if (metaEl) metaEl.textContent = name || 'Uploaded';
            if (urlInput) {
                urlInput.value = url;
                urlInput.dispatchEvent(new Event('input'));
            }
            zone.style.borderColor = 'var(--mainra-success)';
        }

        function clearPastedImage() {
            if (promptBox) promptBox.style.display = 'flex';
            if (previewBox) previewBox.style.display = 'none';
            if (thumb) thumb.src = '';
            if (urlInput) {
                urlInput.value = '';
                urlInput.dispatchEvent(new Event('input'));
            }
            zone.style.borderColor = '';
            zone.style.background = '';
        }

        async function processImageFile(file) {
            if (!file) return;
            if (file.type && !file.type.startsWith('image/')) {
                toast('File yang dipilih bukan gambar yang valid.', true);
                return;
            }

            var reader = new FileReader();
            reader.onload = async function (e) {
                var dataUrl = e.target.result;
                setUploading(true, file.name || 'clipboard-image.png', dataUrl);

                try {
                    var res = await sb.functions.invoke('upload-image', {
                        body: {
                            base64Data: dataUrl,
                            mimeType: file.type || 'image/png',
                            fileName: 'broadcast-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ((file.type || 'image/png').split('/')[1] || 'png')
                        }
                    });

                    if (res.error) throw res.error;
                    if (res.data && res.data.error) throw new Error(res.data.message);

                    var publicUrl = res.data && res.data.publicUrl;
                    if (!publicUrl) throw new Error('URL gambar tidak diterima dari server.');

                    setSuccess(publicUrl, file.name || 'Pasted Image');
                    toast('Gambar berhasil di-paste & diupload! ✓');
                } catch (err) {
                    clearPastedImage();
                    toast('Upload gambar gagal: ' + (err.message || err), true);
                }
            };
            reader.readAsDataURL(file);
        }

        // 1. Click zone triggers file selector (except when clicking direct paste button or remove button)
        zone.onclick = function (e) {
            if (e.target.closest('#removePastedImageBtn') || e.target.closest('#directClipboardBtn')) return;
            if (fileInput) fileInput.click();
        };

        // 1b. Direct button trigger for navigator.clipboard.read() (Explicit User Gesture)
        var clipBtn = $('#directClipboardBtn');
        if (clipBtn) {
            clipBtn.onclick = async function (e) {
                e.stopPropagation();
                if (!navigator.clipboard || !navigator.clipboard.read) {
                    toast('Browser tidak mendukung Clipboard API langsung. Gunakan shortcut Ctrl+V.', true);
                    return;
                }
                try {
                    clipBtn.disabled = true;
                    clipBtn.textContent = 'Membaca Clipboard…';
                    var items = await navigator.clipboard.read();
                    var found = false;
                    for (var i = 0; i < items.length; i++) {
                        var imgType = items[i].types.find(function (t) { return t.startsWith('image/'); });
                        if (imgType) {
                            var blob = await items[i].getType(imgType);
                            if (blob) {
                                found = true;
                                processImageFile(blob);
                                break;
                            }
                        }
                    }
                    clipBtn.disabled = false;
                    clipBtn.textContent = '📋 Paste dari Clipboard';
                    if (!found) {
                        toast('Tidak ada gambar yang disalin di clipboard saat ini. Salin gambar terlebih dahulu (Ctrl+C / Snipping Tool).', true);
                    }
                } catch (err) {
                    clipBtn.disabled = false;
                    clipBtn.textContent = '📋 Paste dari Clipboard';
                    toast('Akses clipboard ditolak atau tidak diizinkan: ' + (err.message || err), true);
                }
            };
        }

        if (fileInput) {
            fileInput.onchange = function () {
                if (fileInput.files && fileInput.files[0]) {
                    processImageFile(fileInput.files[0]);
                }
            };
        }

        if (removeBtn) {
            removeBtn.onclick = function (e) {
                e.stopPropagation();
                clearPastedImage();
            };
        }

        // 2. Drag and drop onto zone
        zone.ondragover = function (e) {
            e.preventDefault();
            zone.style.borderColor = 'var(--mainra-orange)';
            zone.style.background = 'rgba(255,107,0,0.08)';
        };

        zone.ondragleave = function (e) {
            e.preventDefault();
            zone.style.borderColor = '';
            zone.style.background = '';
        };

        zone.ondrop = function (e) {
            e.preventDefault();
            zone.style.borderColor = '';
            zone.style.background = '';
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                processImageFile(e.dataTransfer.files[0]);
            }
        };

        // 3. Global Clipboard Paste (Ctrl+V anywhere in broadcast form or page when social tab active)
        window.addEventListener('paste', function (e) {
            // Check if user is actively in social tab
            var socialTab = $('#tab-social');
            if (!socialTab || !socialTab.classList.contains('active')) return;

            // Don't intercept text pastes in title/prompt/key inputs unless it contains an image
            var clipboard = e.clipboardData || window.clipboardData;
            if (!clipboard) return;

            var hasImage = false;
            // Check clipboard.files
            if (clipboard.files && clipboard.files.length > 0) {
                for (var f = 0; f < clipboard.files.length; f++) {
                    if (clipboard.files[f].type && clipboard.files[f].type.indexOf('image') !== -1) {
                        e.preventDefault();
                        processImageFile(clipboard.files[f]);
                        return;
                    }
                }
            }

            // Check clipboard.items
            var items = clipboard.items;
            if (items) {
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type && items[i].type.indexOf('image') !== -1) {
                        var blob = items[i].getAsFile();
                        if (blob) {
                            e.preventDefault();
                            processImageFile(blob);
                            return;
                        }
                    }
                }
            }
        });
    }

    function wireScheduleControls() {
        var nowBtn = $('#scheduleNowModeBtn');
        var laterBtn = $('#scheduleLaterModeBtn');
        var pickerBox = $('#scheduleTimePickerBox');
        var submitBtn = $('#broadcastSubmitBtn');
        var timeInput = $('#postScheduleTime');

        if (nowBtn && laterBtn && pickerBox) {
            nowBtn.onclick = function () {
                isScheduleMode = false;
                nowBtn.style.borderColor = 'var(--mainra-orange)';
                nowBtn.style.color = 'var(--mainra-orange)';
                laterBtn.style.borderColor = '';
                laterBtn.style.color = '';
                pickerBox.style.display = 'none';
                if (submitBtn) submitBtn.textContent = '🚀 Terbitkan Berita & Broadcast Sekarang';
            };

            laterBtn.onclick = function () {
                isScheduleMode = true;
                laterBtn.style.borderColor = 'var(--mainra-orange)';
                laterBtn.style.color = 'var(--mainra-orange)';
                nowBtn.style.borderColor = '';
                nowBtn.style.color = '';
                pickerBox.style.display = 'block';

                // Default to +2 hours from now if empty
                if (timeInput && !timeInput.value) {
                    var d = new Date(Date.now() + 2 * 60 * 60 * 1000);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    timeInput.value = d.toISOString().slice(0, 16);
                }
                if (submitBtn) submitBtn.textContent = '📅 Jadwalkan Broadcast Konten';
            };
        }
    }

    async function handleSocialBroadcastSubmit(e) {
        e.preventDefault();
        var submitBtn = $('#broadcastSubmitBtn');
        var title = $('#postTitle').value.trim();
        var content = $('#postContent').value.trim();
        var imageUrl = $('#postImage').value.trim();
        var targetLink = $('#postLink').value.trim();

        var checkedProfiles = [];
        $$('input[name="buffer_profile"]:checked').forEach(function (cb) {
            checkedProfiles.push(cb.value);
        });

        if (!title || !content) {
            toast('Judul dan teks postingan harus diisi.', true);
            return;
        }

        if (checkedProfiles.length === 0) {
            toast('Pilih minimal 1 channel sosial media tujuan.', true);
            return;
        }

        var scheduleTimeVal = null;
        if (isScheduleMode) {
            var timeInput = $('#postScheduleTime');
            scheduleTimeVal = timeInput ? timeInput.value : '';
            if (!scheduleTimeVal) {
                toast('Pilih tanggal dan jam publikasi terlebih dahulu.', true);
                return;
            }
            if (new Date(scheduleTimeVal) <= new Date()) {
                toast('Waktu jadwal harus lebih dari waktu saat ini.', true);
                return;
            }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = isScheduleMode ? '📅 Menjadwalkan Broadcast…' : '🚀 Memproses & Menyesuaikan Broadcast…';

        var res = await sb.functions.invoke('sync-buffer', {
            body: {
                action: 'publish',
                title: title,
                text: content,
                imageUrl: imageUrl || null,
                targetLink: targetLink || null,
                profileIds: checkedProfiles,
                scheduleTime: scheduleTimeVal
            }
        });

        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 Terbitkan Berita & Broadcast Sekarang';

        if (res.error) {
            toast('Gagal broadcast: ' + (res.error.message || res.error), true);
            return;
        }

        var results = (res.data && res.data.bufferResults) || [];
        var failedList = results.filter(function (r) { return r.status === 'failed'; });

        if (failedList.length > 0 && failedList.length === results.length) {
            toast('Peringatan: Gagal mempublikasikan ke channel Buffer. Cek pesan error di riwayat.', true);
        } else if (failedList.length > 0) {
            toast('Sebagian channel berhasil (' + (results.length - failedList.length) + '/' + results.length + '). Detail tersimpan di riwayat. ⚠️');
        } else {
            toast((res.data && res.data.message) || 'Broadcast berhasil dipublikasikan ke semua platform! ✓');
        }

        $('#postTitle').value = '';
        $('#postContent').value = '';
        $('#postImage').value = '';
        $('#postLink').value = '';
        updateSocialLimitIndicators(0);
        wireLivePreview();
        loadSocialBroadcasts();
    }

    /* ---------- admin users management ---------- */

    var adminList = [];

    async function loadAdmins() {
        var tbody = $('#adminsTbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:2rem"><span style="display:inline-block;animation:spin 1s linear infinite;margin-right:.5rem">↻</span> Memuat daftar akun admin…</td></tr>';

        try {
            // First attempt via direct database query (instant & guaranteed by RLS)
            var dbRes = await sb.from('admin_users').select('*').order('created_at', { ascending: true });
            
            // Try calling Edge Function for enriched auth metadata (last_sign_in_at)
            var fnRes = await sb.functions.invoke('manage-admins', {
                body: { action: 'list' }
            }).catch(function (e) { return { error: e }; });

            if (fnRes && !fnRes.error && fnRes.data && fnRes.data.admins) {
                adminList = fnRes.data.admins;
            } else if (dbRes && !dbRes.error && dbRes.data) {
                // Fallback to direct DB records if Edge Function had network/cold-start delay
                var sessionUser = (await sb.auth.getUser()).data.user;
                adminList = dbRes.data.map(function (row) {
                    return {
                        user_id: row.user_id,
                        email: row.email,
                        created_at: row.created_at,
                        last_sign_in_at: null,
                        is_current_user: sessionUser ? row.user_id === sessionUser.id : false
                    };
                });
            } else {
                var errText = (fnRes && fnRes.error && (fnRes.error.message || fnRes.error)) ||
                              (dbRes && dbRes.error && dbRes.error.message) || 'Unknown error';
                tbody.innerHTML = '<tr><td colspan="5" class="error" style="text-align:center;padding:1.5rem">Gagal memuat admin: ' + esc(errText) + '</td></tr>';
                return;
            }

            if (!adminList.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:1.5rem">Belum ada akun admin terdaftar.</td></tr>';
                return;
            }

            tbody.innerHTML = adminList.map(function (adm, idx) {
                var isMe = adm.is_current_user;
                var createdDate = adm.created_at ? new Date(adm.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
                var lastSignIn = adm.last_sign_in_at ? new Date(adm.last_sign_in_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

                return '<tr>' +
                    '<td>' +
                        '<strong>' + esc(adm.email) + '</strong>' +
                        (isMe ? ' <span class="badge ok" style="margin-left:.4rem;font-size:.72rem">Anda (Saat ini)</span>' : '') +
                    '</td>' +
                    '<td><span class="badge ok">Full Access</span></td>' +
                    '<td class="muted" style="font-size:.85rem">' + esc(lastSignIn) + '</td>' +
                    '<td class="muted" style="font-size:.85rem">' + esc(createdDate) + '</td>' +
                    '<td style="text-align:right">' +
                        (isMe ? 
                            '<span class="muted small" style="font-size:.8rem">—</span>' :
                            '<button type="button" class="btn-admin ghost danger small" data-del-admin="' + idx + '" style="font-size:.78rem;padding:.25rem .6rem;color:#f87171;border-color:rgba(239,68,68,.3)">Hapus Akses</button>') +
                    '</td>' +
                '</tr>';
            }).join('');

            $$('[data-del-admin]').forEach(function (btn) {
                btn.onclick = function () {
                    var target = adminList[Number(btn.dataset.delAdmin)];
                    if (!target) return;
                    deleteAdminUser(target);
                };
            });
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="5" class="error" style="text-align:center;padding:1.5rem">Terjadi kesalahan: ' + esc(e.message) + '</td></tr>';
        }
    }

    async function deleteAdminUser(target) {
        if (!confirm('Apakah Anda yakin ingin menghapus hak akses admin untuk ' + target.email + '?\nPengguna ini tidak akan bisa login lagi ke dashboard.')) {
            return;
        }

        toast('Menghapus akses admin…');
        var res = await sb.functions.invoke('manage-admins', {
            body: { action: 'delete', user_id: target.user_id }
        });

        if (res.error) {
            toast('Gagal menghapus: ' + (res.error.message || res.error), true);
            return;
        }

        toast('Admin ' + target.email + ' berhasil dihapus ✓');
        loadAdmins();
    }

    function openAddAdminModal() {
        $('#newAdminEmail').value = '';
        $('#newAdminPassword').value = '';
        $('#admError').textContent = '';
        $('#admError').classList.add('hidden');
        $('#adminUserModal').showModal();
    }

    async function submitNewAdmin(e) {
        e.preventDefault();
        var email = $('#newAdminEmail').value.trim();
        var password = $('#newAdminPassword').value.trim();
        var errEl = $('#admError');
        var submitBtn = $('#admSubmitBtn');

        if (!email || !password) {
            errEl.textContent = 'Mohon isi email dan password.';
            errEl.classList.remove('hidden');
            return;
        }
        if (password.length < 6) {
            errEl.textContent = 'Password harus minimal 6 karakter.';
            errEl.classList.remove('hidden');
            return;
        }

        errEl.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menambahkan…';

        var res = await sb.functions.invoke('manage-admins', {
            body: { action: 'create', email: email, password: password }
        });

        submitBtn.disabled = false;
        submitBtn.textContent = '+ Tambahkan Sebagai Admin';

        if (res.error) {
            var msg = res.error.message || res.error;
            errEl.textContent = 'Gagal: ' + msg;
            errEl.classList.remove('hidden');
            return;
        }

        $('#adminUserModal').close();
        toast('Admin ' + email + ' berhasil ditambahkan ✓');
        loadAdmins();
    }

    /* ---------- contact inbox ---------- */

    var currentInboxFilter = 'all';
    var cachedInboxMessages = [];

    window.setInboxFilter = function (filter) {
        currentInboxFilter = filter;
        ['all', 'unread', 'read', 'replied'].forEach(function (f) {
            var btn = $('#inboxFilter' + f.charAt(0).toUpperCase() + f.slice(1));
            if (btn) btn.classList.toggle('active', f === filter);
        });
        renderInboxTable();
    };

    async function checkInboxBadge() {
        if (!sb) return;
        var res = await sb.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'unread');
        if (!res.error && typeof res.count === 'number') {
            updateInboxBadge(res.count);
        }
    }

    function updateInboxBadge(unreadCount) {
        var badge = $('#inboxUnreadBadge');
        if (!badge) return;
        if (unreadCount > 0) {
            badge.style.display = 'inline-block';
            badge.textContent = unreadCount;
        } else {
            badge.style.display = 'none';
        }
    }

    window.loadInboxMessages = async function () {
        var tb = $('#inboxTbody');
        if (!tb) return;
        tb.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:2rem"><span style="display:inline-block;animation:spin 1s linear infinite;margin-right:.5rem">↻</span> Memuat pesan masuk…</td></tr>';

        var res = await sb.from('contact_messages')
            .select('*')
            .order('created_at', { ascending: false });

        if (res.error) {
            tb.innerHTML = '<tr><td colspan="5" class="error-cell" style="text-align:center;padding:1.5rem">Gagal memuat pesan: ' + esc(res.error.message) + '</td></tr>';
            return;
        }

        cachedInboxMessages = res.data || [];
        var unreadTotal = cachedInboxMessages.filter(function (m) { return m.status === 'unread'; }).length;
        updateInboxBadge(unreadTotal);
        renderInboxTable();
    };

    function renderInboxTable() {
        var tb = $('#inboxTbody');
        if (!tb) return;

        var list = cachedInboxMessages;
        if (currentInboxFilter !== 'all') {
            list = list.filter(function (m) { return m.status === currentInboxFilter; });
        }

        if (!list.length) {
            tb.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:2.5rem">' +
                (currentInboxFilter === 'all' ? 'Belum ada pesan masuk dari formulir website.' : 'Tidak ada pesan dengan filter ini.') +
                '</td></tr>';
            return;
        }

        var html = '';
        list.forEach(function (m) {
            var dateStr = '-';
            try {
                dateStr = new Date(m.created_at).toLocaleString('id-ID', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
            } catch (e) { dateStr = m.created_at || '-'; }

            var statusBadge = '';
            if (m.status === 'unread') {
                statusBadge = '<span style="background:rgba(239,68,68,.15);color:#fca5a5;border:1px solid rgba(239,68,68,.4);padding:2px 8px;border-radius:999px;font-size:.75rem;font-weight:600;">Belum Dibaca</span>';
            } else if (m.status === 'replied') {
                statusBadge = '<span style="background:rgba(127,209,161,.15);color:var(--mainra-success);border:1px solid rgba(127,209,161,.4);padding:2px 8px;border-radius:999px;font-size:.75rem;font-weight:600;">Sudah Dibalas</span>';
            } else {
                statusBadge = '<span style="background:rgba(255,255,255,.06);color:var(--admin-text-secondary);border:1px solid var(--admin-border-subtle);padding:2px 8px;border-radius:999px;font-size:.75rem;font-weight:500;">Sudah Dibaca</span>';
            }

            var safeMsg = esc(m.message || '');
            var snippet = safeMsg.length > 80 ? safeMsg.slice(0, 80) + '…' : safeMsg;

            html += '<tr style="' + (m.status === 'unread' ? 'background:rgba(255,107,0,.03);' : '') + '">' +
                '<td>' +
                    '<strong style="color:var(--admin-text-main);display:block;font-size:.9rem;">' + esc(m.name || 'Anonymous') + '</strong>' +
                    '<a href="mailto:' + esc(m.email) + '" style="color:var(--admin-text-muted);font-size:.8rem;text-decoration:none;">' + esc(m.email) + '</a>' +
                '</td>' +
                '<td>' +
                    (m.subject ? '<div style="font-weight:600;color:var(--admin-text-main);font-size:.88rem;margin-bottom:2px;">' + esc(m.subject) + '</div>' : '') +
                    '<div style="color:var(--admin-text-secondary);font-size:.82rem;line-height:1.4;">' + snippet + '</div>' +
                '</td>' +
                '<td>' + statusBadge + '</td>' +
                '<td style="font-size:.8rem;color:var(--admin-text-muted);">' + dateStr + '</td>' +
                '<td style="text-align:right;">' +
                    '<button type="button" class="btn-admin ghost" style="padding:.25rem .55rem;font-size:.78rem;margin-right:.3rem;" onclick="viewInboxMessage(\'' + esc(m.id) + '\')">Buka</button>' +
                    '<button type="button" class="btn-admin ghost" style="padding:.25rem .5rem;font-size:.78rem;color:#ef4444;border-color:rgba(239,68,68,.3);" onclick="deleteInboxMessage(\'' + esc(m.id) + '\')">✕</button>' +
                '</td>' +
            '</tr>';
        });

        tb.innerHTML = html;
    }

    window.viewInboxMessage = async function (id) {
        var m = cachedInboxMessages.find(function (x) { return x.id === id; });
        if (!m) return;

        var modal = $('#inboxModal');
        if (!modal) return;

        $('#inboxModalSubject').textContent = m.subject || 'Tanpa Subjek';
        $('#inboxModalSender').textContent = m.name || 'Anonymous';
        var mailEl = $('#inboxModalEmailLink');
        mailEl.textContent = m.email;
        mailEl.href = 'mailto:' + encodeURIComponent(m.email);

        try {
            $('#inboxModalDate').textContent = new Date(m.created_at).toLocaleString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { $('#inboxModalDate').textContent = m.created_at || ''; }

        var badge = $('#inboxModalStatusBadge');
        if (m.status === 'unread') {
            badge.textContent = 'Belum Dibaca';
            badge.style.color = '#fca5a5';
        } else if (m.status === 'replied') {
            badge.textContent = 'Sudah Dibalas';
            badge.style.color = 'var(--mainra-success)';
        } else {
            badge.textContent = 'Sudah Dibaca';
            badge.style.color = 'var(--admin-text-secondary)';
        }

        $('#inboxModalBody').textContent = m.message || '';
        var statusSelect = $('#inboxModalStatusSelect');
        if (statusSelect) statusSelect.value = m.status || 'unread';

        var replyMailto = $('#inboxModalReplyMailto');
        if (replyMailto) {
            replyMailto.href = 'mailto:' + encodeURIComponent(m.email) +
                '?subject=' + encodeURIComponent('Re: ' + (m.subject || 'Pesan Mainra Games')) +
                '&body=' + encodeURIComponent('\n\n--- Pesan Asli dari ' + m.name + ' ---\n' + m.message);
        }

        var delBtn = $('#inboxModalDeleteBtn');
        if (delBtn) {
            delBtn.onclick = function () {
                modal.close();
                deleteInboxMessage(m.id);
            };
        }

        statusSelect.onchange = async function () {
            var newStatus = statusSelect.value;
            var res = await sb.from('contact_messages').update({ status: newStatus }).eq('id', m.id);
            if (res.error) {
                toast('Gagal update status: ' + res.error.message, true);
            } else {
                m.status = newStatus;
                toast('Status pesan diperbarui ke: ' + newStatus);
                renderInboxTable();
                var unreadTotal = cachedInboxMessages.filter(function (x) { return x.status === 'unread'; }).length;
                updateInboxBadge(unreadTotal);
            }
        };

        modal.showModal();

        // Auto mark as read if it was unread
        if (m.status === 'unread') {
            sb.from('contact_messages').update({ status: 'read' }).eq('id', m.id).then(function (res) {
                if (!res.error) {
                    m.status = 'read';
                    statusSelect.value = 'read';
                    badge.textContent = 'Sudah Dibaca';
                    badge.style.color = 'var(--admin-text-secondary)';
                    renderInboxTable();
                    var unreadTotal = cachedInboxMessages.filter(function (x) { return x.status === 'unread'; }).length;
                    updateInboxBadge(unreadTotal);
                }
            });
        }
    };

    window.deleteInboxMessage = async function (id) {
        if (!confirm('Apakah Anda yakin ingin menghapus pesan ini secara permanen?')) return;
        var res = await sb.from('contact_messages').delete().eq('id', id);
        if (res.error) {
            toast('Gagal menghapus pesan: ' + res.error.message, true);
        } else {
            toast('Pesan berhasil dihapus ✓');
            cachedInboxMessages = cachedInboxMessages.filter(function (m) { return m.id !== id; });
            renderInboxTable();
            var unreadTotal = cachedInboxMessages.filter(function (m) { return m.status === 'unread'; }).length;
            updateInboxBadge(unreadTotal);
        }
    };

    /* ---------- boot ---------- */

    function init() {
        // Optimistic fast-path: If Supabase auth token exists in localStorage, keep login view hidden
        try {
            var hasSavedSession = false;
            for (var k in localStorage) {
                if (k.indexOf('sb-') === 0 && k.indexOf('-auth-token') !== -1) {
                    var raw = localStorage.getItem(k);
                    if (raw && raw.indexOf('access_token') !== -1) {
                        hasSavedSession = true;
                        break;
                    }
                }
            }
            if (hasSavedSession) {
                var lv = $('#loginView');
                if (lv) { lv.style.display = 'none'; lv.classList.remove('is-active'); }
            }
        } catch (e) {}

        if (typeof window.supabaseClient === 'undefined' || !window.supabaseClient) {
            hideSplash();
            $('#loginView').style.display = 'grid';
            $('#loginError').textContent = 'Supabase client failed to load. Check network / supabase-config.js.';
            $('#loginError').classList.remove('hidden');
            return;
        }
        sb = window.supabaseClient;

        function on(sel, evt, handler) {
            var el = $(sel);
            if (el) el.addEventListener(evt, handler);
        }

        on('#loginForm', 'submit', doLogin);
        on('#logoutBtn', 'click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
        $$('.admin-nav button').forEach(function (b) { b.addEventListener('click', function () { selectTab(b.dataset.tab); }); });
        $$('.subtab-btn').forEach(function (b) { b.addEventListener('click', function () { selectGamesSubtab(b.dataset.subtab); }); });
        on('#newGameBtn', 'click', function () { openGameModal(null); });
        on('#gmClose', 'click', function () { $('#gameModal').close(); });
        on('#gmCancel', 'click', function () { $('#gameModal').close(); });
        on('#gameForm', 'submit', saveGame);
        on('#refreshStoreBtn', 'click', function () { callFunction('sync-playstore'); });
        on('#hideFeaturedBtn', 'click', hideFeatured);
        on('#exportJsonBtn', 'click', exportJson);
        
        on('#syncAnalyticsBtn', 'click', function () {
            var btn = $('#syncAnalyticsBtn');
            var gid = btn ? btn.dataset.gid : null;
            syncTabAnalytics(gid || null);
        });
        on('#analyticsGameFilter', 'change', renderAnalyticsTab);
        
        var backBtn = $('#backToOverviewBtn');
        if (backBtn) {
            backBtn.addEventListener('click', function () {
                var agf = $('#analyticsGameFilter');
                if (agf) agf.value = '';
                $$('.scope-pill').forEach(function (p) {
                    var active = (p.dataset.scope || '') === '';
                    p.classList.toggle('active', active);
                    p.setAttribute('aria-selected', active);
                });
                renderAnalyticsTab();
            });
        }

        on('#rpClose', 'click', function () { $('#replyModal').close(); });
        on('#rpCancel', 'click', function () { $('#replyModal').close(); });
        on('#rpSaveDraft', 'click', saveReplyDraft);
        on('#rpPostGoogle', 'click', postReplyToGoogle);
        
        on('#reviewGameFilter', 'change', renderReviews);
        on('#reviewStateFilter', 'change', renderReviews);
        on('#syncReviewsBtn', 'click', function () { callFunction('sync-reviews'); });
        on('#syncGamesBtn', 'click', function () { callFunction('sync-playstore'); });

        on('#newAdminBtn', 'click', openAddAdminModal);
        on('#inboxModalClose', 'click', function () { $('#inboxModal').close(); });
        on('#admClose', 'click', function () { $('#adminUserModal').close(); });
        on('#admCancel', 'click', function () { $('#adminUserModal').close(); });
        on('#adminUserForm', 'submit', submitNewAdmin);

        on('#socialBroadcastForm', 'submit', handleSocialBroadcastSubmit);
        var postContentInput = $('#postContent');
        if (postContentInput) {
            postContentInput.addEventListener('input', function () {
                var len = postContentInput.value.length;
                $('#postCharCount').textContent = len + ' / 1000 karakter';
            });
        }

        sb.auth.onAuthStateChange(function (event, session) {
            if (event === 'SIGNED_OUT') {
                showLogin();
            }
        });

        var saved = 'games';
        try { saved = localStorage.getItem('mainra-admin-tab') || 'games'; } catch (e) {}
        selectTab(saved);

        sb.auth.getSession().then(function (res) {
            var session = res.data && res.data.session;
            if (session && session.user) {
                checkAdmin(session.user);
            } else {
                showLogin();
            }
        }).catch(function () {
            showLogin();
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
