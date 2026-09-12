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
        var loginView = $('#loginView');
        if (loginView) {
            loginView.classList.remove('is-active');
            loginView.style.display = 'none';
        }
        $('#adminShell').classList.add('is-on');
        $('#who').textContent = user.email || 'admin';
        loadAll();
    }

    function showLogin() {
        $('#adminShell').classList.remove('is-on');
        var loginView = $('#loginView');
        if (loginView) {
            loginView.classList.add('is-active');
            loginView.style.display = 'grid';
        }
    }

    async function checkAdmin(user) {
        if (!user) { showLogin(); return; }
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

        // Render modern segmented pill bar for Analytics
        var scopeBar = $('#analyticsScopeBar');
        if (scopeBar) {
            var currentVal = $('#analyticsGameFilter').value || '';
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
                btn.addEventListener('click', function () {
                    var scopeId = btn.dataset.scope || '';
                    $('#analyticsGameFilter').value = scopeId;
                    $$('.scope-pill').forEach(function (p) {
                        var active = (p.dataset.scope || '') === scopeId;
                        p.classList.toggle('active', active);
                        p.setAttribute('aria-selected', active);
                    });
                    renderAnalyticsTab();
                });
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
        selectTab('analytics');
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

    var overviewFilterMode = 'all';
    var singleFilterMode = 'all';

    function filterReviewItems(items, mode) {
        if (!items) return [];
        if (mode === 'unreplied') {
            return items.filter(function (r) {
                var txt = (r.reply_text || '').trim();
                return !txt;
            });
        }
        if (mode === 'replied') {
            return items.filter(function (r) {
                var txt = (r.reply_text || '').trim();
                return !!txt;
            });
        }
        if (mode === '5star') {
            return items.filter(function (r) {
                return Number(r.star_rating) === 5;
            });
        }
        if (mode === 'critical') {
            return items.filter(function (r) {
                var s = Number(r.star_rating);
                return s < 5 && s > 0;
            });
        }
        return items;
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
                var filtered = filterReviewItems(reviews, overviewFilterMode);
                if ($('#overviewFeedCount')) {
                    $('#overviewFeedCount').textContent = filtered.length + ' of ' + reviews.length;
                }

                if (!filtered.length) {
                    feedBox.innerHTML = '<div class="muted" style="text-align:center;padding:1.8rem">' +
                        'No reviews match the current filter (' + esc(overviewFilterMode) + ').' +
                    '</div>';
                    return;
                }

                var displayItems = filtered.slice(0, 8);
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

        var rows = filterReviewItems(allRows, singleFilterMode);
        if (countBadge) countBadge.textContent = rows.length + ' of ' + allRows.length;

        if (!rows.length) {
            box.innerHTML = '<div class="muted" style="text-align:center;padding:1.5rem">No reviews match the "' + esc(singleFilterMode) + '" filter.</div>';
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

        // Wire single game filter chips
        $$('#singleFeedFilters .filter-chip').forEach(function (chip) {
            chip.onclick = function () {
                $$('#singleFeedFilters .filter-chip').forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                singleFilterMode = chip.dataset.filter;
                loadTabReviews(gameId);
            };
        });
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

    var TITLES = { games: 'Games & Featured', analytics: 'Analytics Overview', reviews: 'Reviews', admins: 'Admins' };
    function selectTab(name) {
        if (name === 'featured') name = 'games';
        $$('.admin-nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
        $$('.tab').forEach(function (t) { t.classList.toggle('active', t.id === 'tab-' + name); });
        $('#tabTitle').textContent = TITLES[name] || name;
        window.scrollTo({ top: 0, behavior: 'auto' });
        try { localStorage.setItem('mainra-admin-tab', name); } catch (e) {}
        if (name === 'analytics') {
            renderAnalyticsTab();
        } else if (name === 'admins') {
            loadAdmins();
        }
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
                $$('.scope-pill').forEach(function (p) {
                    var active = (p.dataset.scope || '') === '';
                    p.classList.toggle('active', active);
                    p.setAttribute('aria-selected', active);
                });
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

        $('#newAdminBtn').addEventListener('click', openAddAdminModal);
        $('#admClose').addEventListener('click', function () { $('#adminUserModal').close(); });
        $('#admCancel').addEventListener('click', function () { $('#adminUserModal').close(); });
        $('#adminUserForm').addEventListener('submit', submitNewAdmin);

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
