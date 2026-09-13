class GamesLoader {
    constructor() {
        this.games = [];
        this.highlight = null;
        this.loadError = false;
        this.init();
    }

    async init() {
        console.log('Initializing GamesLoader...');
        await this.loadGames();
        console.log('Games loaded in GamesLoader:', this.games.length);
        console.log('Highlight data in GamesLoader:', this.highlight);
        this.renderGames();
        console.log('GamesLoader initialized successfully');
    }

    async loadGames() {
        // Primary source: Supabase CMS data (with 4-second timeout to prevent blocking), fallback: static JSON.
        try {
            if (window.supabaseClient) {
                const fetchPromise = Promise.all([
                    window.supabaseClient.from('games').select('*').order('sort_order', { ascending: true }).order('title'),
                    window.supabaseClient.from('site_settings').select('value').eq('key', 'highlight').maybeSingle()
                ]);

                // Timeout fallback after 4s in case of degraded network
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Supabase request timeout')), 4000)
                );

                const [gamesRes, settingsRes] = await Promise.race([fetchPromise, timeoutPromise]);
                if (!gamesRes.error && Array.isArray(gamesRes.data) && gamesRes.data.length > 0) {
                    this.games = gamesRes.data;
                    this.highlight = (settingsRes && !settingsRes.error && settingsRes.data && settingsRes.data.value) || null;
                    return;
                }
                if (gamesRes.error) console.warn('Supabase games unavailable, falling back to JSON:', gamesRes.error.message);
            }
        } catch (error) {
            console.warn('Supabase load failed or timed out, falling back to JSON:', error);
        }

        // Fallback ke file JSON
        try {
            const response = await fetch('Assets/data/games-data.json');
            if (!response.ok) { throw new Error(`Failed to load games data: ${response.status}`); }
            const data = await response.json();
            this.games = data.games || [];
            this.highlight = data.highlight || null;
        } catch (error) {
            console.error('Error loading games from JSON:', error);

            // Never invent game data when the source fails.
            this.games = [];
            this.highlight = null;
            this.loadError = true;
        }
    }

    safeUrl(value, allowedHosts = []) {
        if (typeof value !== 'string' || !value.trim()) return '';

        try {
            const url = new URL(value.trim());
            if (url.protocol !== 'https:' || url.username || url.password) return '';
            if (allowedHosts.length > 0 && !allowedHosts.includes(url.hostname)) return '';
            return url.href;
        } catch {
            return '';
        }
    }

    bindImageFallbacks(container) {
        container.querySelectorAll('img[data-fallback-src]').forEach(image => {
            image.addEventListener('error', () => {
                image.classList.add('is-branded-fallback');
                image.src = 'Assets/img/LogoMainraGames.png';
            }, { once: true });
        });
    }

    bindGameCardLinks(container) {
        container.querySelectorAll('[data-play-link]').forEach(card => {
            const openGame = () => {
                const url = this.safeUrl(card.dataset.playLink, ['play.google.com']);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
            };
            card.addEventListener('click', openGame);
            card.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openGame();
                }
            });
        });
        this.bindImageFallbacks(container);
    }

    renderGames() {
        console.log('Starting renderGames...');

        // Render games in homepage
        this.renderHomepageGames();

        // Render games in games page if exists
        if (window.location.pathname.includes('games.html') || document.querySelector('.games-list')) {
            console.log('Rendering games page...');
            this.renderGamesPage();
            this.renderHighlightGame();
        }

        console.log('renderGames completed');
    }

    renderHomepageGames() {
        const gamesGrid = document.querySelector('#games .games-grid');
        console.log('Homepage games grid found:', !!gamesGrid);

        if (!gamesGrid) return;

        // Show latest games for homepage (max 3) - sort by releaseDate (newest first) or id
        const latestGames = [...this.games].sort((a, b) => {
            // Prioritaskan releaseDate jika tersedia
            if (a.releaseDate && b.releaseDate) {
                return new Date(b.releaseDate) - new Date(a.releaseDate);
            }
            // Fallback ke ID (tertinggi = terbaru)
            return String(b.id || '').localeCompare(String(a.id || ''));
        }).slice(0, 3);
        gamesGrid.classList.toggle('is-bento', latestGames.length === 3);
        console.log('Latest games for homepage:', latestGames.length);

        if (latestGames.length === 0) {
            console.log('No games found, showing empty state');
            gamesGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #999;">
                    <i class="fas fa-gamepad" aria-hidden="true" style="font-size: 4rem; margin-bottom: 1rem;"></i>
                    <p>No games available yet</p>
                </div>
            `;
            return;
        }

        gamesGrid.innerHTML = latestGames.map(game => {
            // Normalisasi icon agar selalu menggunakan s256-rw
            let gameIcon = game.image || '';
            if (gameIcon && gameIcon.includes('play-lh.googleusercontent.com')) {
                // SELALU gunakan s256-rw untuk konsistensi
                const baseUrl = gameIcon.split('?')[0].split('=')[0];
                if (gameIcon.match(/=s\d+-rw/) || gameIcon.includes('=w') || gameIcon.includes('=h')) {
                    // Ganti parameter yang ada dengan s256-rw
                    gameIcon = baseUrl + '=s256-rw';
                } else {
                    // Tambahkan s256-rw jika tidak ada parameter
                    gameIcon = baseUrl + '=s256-rw';
                }
            }
            
            const playLink = this.safeUrl(game.playLink, ['play.google.com']);
            const imageUrl = this.safeUrl(gameIcon, ['play-lh.googleusercontent.com']) || 'Assets/img/LogoMainraGames.png';
            return `
            <div class="game-item simple-card" ${playLink ? `data-play-link="${this.escapeHtml(playLink)}" tabindex="0" role="link"` : ''}>
                <img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(game.title)}" class="game-img" width="640" height="400" loading="lazy" decoding="async" data-fallback-src="Assets/img/LogoMainraGames.png">
                <h3 class="game-title">${this.escapeHtml(game.title)}</h3>
            </div>
            `;
        }).join('');
        this.bindGameCardLinks(gamesGrid);

        console.log('Homepage games rendered successfully');
    }

    renderHighlightGame() {
        const highlightText = document.querySelector('.highlight-text');
        const highlightImage = document.querySelector('.highlight-image .carousel-wrapper');

        // Use loaded highlight data
        const highlightData = this.highlight;

        if (!highlightData || !highlightData.active) {
            // Show no highlight message
            if (highlightText) {
                highlightText.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: #999;">
                        <i class="fas fa-crown" aria-hidden="true" style="font-size: 4rem; margin-bottom: 1rem;"></i>
                        <h2 style="color: #666; margin-bottom: 1rem;">No Featured Game Yet</h2>
                        <p>We are preparing the best featured game for you.</p>
                    </div>
                `;
            }
            return;
        }

        // Find the highlighted game
        const highlightGame = this.games.find(game => String(game.id) === String(highlightData.gameId));
        if (!highlightGame) {
            if (highlightText) {
                highlightText.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: #999;">
                        <i class="fas fa-exclamation-triangle" aria-hidden="true" style="font-size: 4rem; margin-bottom: 1rem; color: var(--warning);"></i>
                        <h2 style="color: #666; margin-bottom: 1rem;">Game Not Found</h2>
                        <p>The selected featured game is not available.</p>
                    </div>
                `;
            }
            return;
        }

        // Use custom title and description if available
        const displayTitle = highlightData.customTitle || highlightGame.title;
        const displayDescription = highlightData.customDescription || highlightGame.description;

        // Format description - split by newlines and create paragraphs
        let formattedDescription = '';
        if (displayDescription) {
            // Clean up description - remove excessive emojis and format
            let cleanDesc = displayDescription.trim();
            
            // Remove emoji-only lines at the start
            cleanDesc = cleanDesc.replace(/^[🌊🎮✨🎯🚀💡]+[\s\n]*/g, '');
            
            // Split by common separators
            const descParts = cleanDesc
                .split(/\n+/)
                .filter(part => part.trim().length > 0)
                .map(part => part.trim());
            
            if (descParts.length > 0) {
                // Find first meaningful paragraph (longer than 30 chars)
                let mainDesc = descParts.find(p => p.length > 30 && !p.match(/^[🌊🎮✨🎯🚀💡]/)) || descParts[0];
                
                // If still starts with emoji, remove it
                mainDesc = mainDesc.replace(/^[🌊🎮✨🎯🚀💡]+\s*/, '');
                
                // Limit length for display (keep it readable)
                if (mainDesc.length > 250) {
                    // Try to cut at sentence boundary
                    const cutAt = mainDesc.substring(0, 250).lastIndexOf('.');
                    if (cutAt > 100) {
                        mainDesc = mainDesc.substring(0, cutAt + 1);
                    } else {
                        mainDesc = mainDesc.substring(0, 250) + '...';
                    }
                }
                
                formattedDescription = `<p class="highlight-description">${this.escapeHtml(mainDesc)}</p>`;
            }
        }

        // Update highlight game content
        const playLink = this.safeUrl(highlightGame.playLink, ['play.google.com']);
        const trailerUrl = this.safeUrl(highlightData.youtubeUrl, ['youtube.com', 'www.youtube.com', 'youtu.be']);
        if (highlightText) {
            highlightText.innerHTML = `
                <h2>${this.escapeHtml(displayTitle)}</h2>
                ${formattedDescription}
                <div class="game-actions">
                    ${playLink ?
                        `<a href="${this.escapeHtml(playLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-play"><i class="fas fa-play" aria-hidden="true"></i> Play</a>` : ''
                    }
                    ${trailerUrl ?
                        `<a href="${this.escapeHtml(trailerUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-details"><i class="fab fa-youtube" aria-hidden="true"></i> Trailer</a>` : ''
                    }
                </div>
            `;
        }

        // Update carousel with game screenshots
        if (highlightImage && highlightGame.screenshots && highlightGame.screenshots.length > 0) {
            const fallbackImage = this.safeUrl(highlightGame.image, ['play-lh.googleusercontent.com']) || 'Assets/img/LogoMainraGames.png';
            const slides = highlightGame.screenshots.map((screenshot, index) => {
                const screenshotUrl = this.safeUrl(screenshot, ['play-lh.googleusercontent.com']);
                if (!screenshotUrl) return '';
                return `
                <div class="carousel-slide ${index === 0 ? 'active' : ''}">
                    <img src="${this.escapeHtml(screenshotUrl)}" alt="${this.escapeHtml(displayTitle)} screenshot ${index + 1}" width="768" height="480" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'} data-fallback-src="${this.escapeHtml(fallbackImage)}">
                </div>
            `;
            }).join('');

            const dots = highlightGame.screenshots.map((screenshot, index) => this.safeUrl(screenshot, ['play-lh.googleusercontent.com']) ? `
                <button type="button" class="dot ${index === 0 ? 'active' : ''}" data-slide="${index}" aria-label="Go to slide ${index + 1}"></button>
            ` : '').join('');

            highlightImage.innerHTML = slides;
            const dotsContainer = document.querySelector('.carousel-dots');
            if (dotsContainer) {
                dotsContainer.innerHTML = dots;
                dotsContainer.querySelectorAll('[data-slide]').forEach(dot => {
                    dot.addEventListener('click', () => {
                        if (typeof window.currentSlide === 'function') {
                            window.currentSlide(Number(dot.dataset.slide) + 1);
                        }
                    });
                });
            }
            this.bindImageFallbacks(highlightImage);
        } else {
            // Use main game image as single slide
            if (highlightImage) {
                const imageUrl = this.safeUrl(highlightGame.image, ['play-lh.googleusercontent.com']) || 'Assets/img/LogoMainraGames.png';
                highlightImage.innerHTML = `
                    <div class="carousel-slide active">
                        <img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(displayTitle)}" width="768" height="480" fetchpriority="high" data-fallback-src="Assets/img/LogoMainraGames.png">
                    </div>
                `;
                this.bindImageFallbacks(highlightImage);
            }

            const dotsContainer = document.querySelector('.carousel-dots');
            if (dotsContainer) {
                dotsContainer.innerHTML = '<button type="button" class="dot active" aria-label="Current slide"></button>';
            }
        }

        const firstImage = highlightImage?.querySelector('img');
        const carousel = highlightImage?.closest('.carousel-container');
        if (firstImage && carousel) {
            const applySourceRatio = () => {
                if (firstImage.naturalWidth && firstImage.naturalHeight) {
                    carousel.style.setProperty('--carousel-aspect-ratio', `${firstImage.naturalWidth} / ${firstImage.naturalHeight}`);
                }
            };
            if (firstImage.complete && firstImage.naturalWidth) applySourceRatio();
            else firstImage.addEventListener('load', applySourceRatio, { once: true });
        }
        try { if (typeof window.initializeCarousel === 'function') setTimeout(window.initializeCarousel, 50); } catch (e) {}
    }

    renderGamesPage() {
        const gamesList = document.querySelector('.games-list');
        if (!gamesList) return;

        if (this.games.length === 0) {
            gamesList.innerHTML = `
                <div class="no-games" style="text-align: center; padding: 3rem; color: #999;">
                    <i class="fas fa-gamepad" aria-hidden="true" style="font-size: 4rem; margin-bottom: 1rem;"></i>
                    <h3>No Games Yet</h3>
                    <p>We are developing exciting games for you.</p>
                </div>
            `;
            return;
        }

        gamesList.innerHTML = this.games.map(game => {
            // Untuk game di list, gunakan icon kecil dari image field
            // Icon sudah benar dari listing page, tidak perlu diubah
            let gameIcon = game.image || '';
            const playLink = this.safeUrl(game.playLink, ['play.google.com']);
            
            // Bersihkan URL jika ada format yang salah (misalnya =w240-h480-rw=s256-rw)
            if (gameIcon.includes('=s256-rw') && gameIcon.includes('=w')) {
                // Ambil bagian sebelum =s256-rw
                const parts = gameIcon.split('=s256-rw');
                if (parts.length > 0) {
                    gameIcon = parts[0] + '=s256-rw';
                }
            }
            
            // Pastikan icon menggunakan format yang benar dan selalu s256-rw
            if (gameIcon && gameIcon.includes('play-lh.googleusercontent.com')) {
                // SELALU gunakan s256-rw untuk konsistensi
                // Ganti semua parameter size (s64, s128, s512, dll) dengan s256-rw
                const baseUrl = gameIcon.split('?')[0].split('=')[0];
                if (gameIcon.match(/=s\d+-rw/) || gameIcon.includes('=w') || gameIcon.includes('=h')) {
                    // Ganti parameter yang ada dengan s256-rw
                    gameIcon = baseUrl + '=s256-rw';
                } else {
                    // Tambahkan s256-rw jika tidak ada parameter
                    gameIcon = baseUrl + '=s256-rw';
                }
            }
            
            // Jika masih tidak ada icon yang valid, gunakan fallback
            if (!gameIcon || gameIcon.length < 10) {
                gameIcon = 'Assets/img/LogoMainraGames.png';
            }
            const safeGameIcon = this.safeUrl(gameIcon, ['play-lh.googleusercontent.com']) || 'Assets/img/LogoMainraGames.png';
            
            var verBadge = '';
            if (game.active_version_name || game.active_version_code) {
                var ver = game.active_version_name || ('v' + game.active_version_code);
                verBadge = `<span class="game-version" style="font-size:.78rem;color:#94a3b8;background:rgba(255,255,255,.07);padding:.15rem .45rem;border-radius:4px">v${this.escapeHtml(ver.replace(/^v/i, ''))}</span>`;
            }

            return `
            <div class="game-item">
                <div class="game-image">
                    <img src="${this.escapeHtml(safeGameIcon)}" alt="${this.escapeHtml(game.title)}" width="256" height="256" loading="lazy" decoding="async" data-fallback-src="Assets/img/LogoMainraGames.png">
                </div>
                <div class="game-content">
                    <h3 class="game-title">${this.escapeHtml(game.title)}</h3>
                    <div class="game-meta" style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                        <span class="game-platform">${this.escapeHtml(game.platform || 'Multi Platform')}</span>
                        ${verBadge}
                        ${game.rating ? `<span class="game-rating">${'★'.repeat(Math.floor(game.rating))} ${game.rating}/5</span>` : ''}
                    </div>
                    <div class="game-actions">
                        ${playLink ?
                            `<a href="${this.escapeHtml(playLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-play">Play</a>` :
                            `<span class="btn" aria-disabled="true">Coming Soon</span>`
                        }
                        <button type="button" class="btn btn-details" data-details-id="${this.escapeHtml(game.id)}">Details</button>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        this.bindImageFallbacks(gamesList);
        this.bindGameDetailsModal(gamesList);
    }

    bindGameDetailsModal(container) {
        container.querySelectorAll('[data-details-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const gameId = btn.dataset.detailsId;
                const game = this.games.find(g => String(g.id) === String(gameId));
                if (game) this.showGameModal(game);
            });
        });
    }

    async showGameModal(game) {
        let modal = document.getElementById('publicGameModal');
        if (!modal) {
            modal = document.createElement('dialog');
            modal.id = 'publicGameModal';
            modal.style.cssText = 'background:#0f172a;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:16px;max-width:640px;width:90%;padding:1.8rem;box-shadow:0 25px 50px -12px rgba(0,0,0,.7);';
            document.body.appendChild(modal);
        }

        const safePlayLink = this.safeUrl(game.playLink, ['play.google.com']);
        const versionBadge = game.active_version_name ? ` · v${this.escapeHtml(game.active_version_name)}` : '';

        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1.2rem">
                <div style="display:flex;gap:1rem;align-items:center">
                    <img src="${this.escapeHtml(game.image || 'Assets/img/LogoMainraGames.png')}" alt="" style="width:60px;height:60px;border-radius:12px;object-fit:cover" onerror="this.src='Assets/img/LogoMainraGames.png'">
                    <div>
                        <h3 style="margin:0;font-size:1.25rem;color:#f8fafc">${this.escapeHtml(game.title)}</h3>
                        <div style="font-size:.85rem;color:#94a3b8;margin-top:.2rem">${this.escapeHtml(game.category || 'Game')}${versionBadge}</div>
                    </div>
                </div>
                <button type="button" id="closePublicModalBtn" style="background:transparent;border:none;color:#94a3b8;font-size:1.4rem;cursor:pointer;padding:.2rem .5rem">✕</button>
            </div>
            <p style="color:#cbd5e1;font-size:.92rem;line-height:1.5;margin-bottom:1.4rem">${this.escapeHtml(game.description || '')}</p>
            
            <div style="border-top:1px solid rgba(255,255,255,.1);padding-top:1.2rem;margin-bottom:1.5rem">
                <h4 style="margin:0 0 .8rem;font-size:1rem;color:#f1f5f9;display:flex;align-items:center;gap:.45rem">
                    <span>💎</span> <span>In-Game Store &amp; In-App Products</span>
                </h4>
                <div id="publicIapItemsList">
                    <div style="font-size:.85rem;color:#94a3b8">Memuat produk in-app…</div>
                </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:.8rem">
                <button type="button" id="closePublicModalFootBtn" style="background:rgba(255,255,255,.08);color:#fff;border:none;padding:.55rem 1.1rem;border-radius:8px;cursor:pointer">Tutup</button>
                ${safePlayLink ? `<a href="${this.escapeHtml(safePlayLink)}" target="_blank" rel="noopener noreferrer" style="background:linear-gradient(135deg,#ff6b00,#e05300);color:#fff;text-decoration:none;font-weight:600;padding:.55rem 1.2rem;border-radius:8px;display:inline-flex;align-items:center;gap:.4rem">Main di Google Play ▶</a>` : ''}
            </div>
        `;

        modal.showModal();

        const closeModal = () => modal.close();
        modal.querySelector('#closePublicModalBtn').onclick = closeModal;
        modal.querySelector('#closePublicModalFootBtn').onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) modal.close(); };

        // Fetch In-App Products for this game from Supabase
        const iapListContainer = modal.querySelector('#publicIapItemsList');
        try {
            if (window.supabaseClient) {
                const { data: iaps, error } = await window.supabaseClient
                    .from('game_inapp_products')
                    .select('title,description,formatted_price,currency,price_micros,purchase_type')
                    .eq('game_id', game.id)
                    .eq('status', 'active');

                if (!error && Array.isArray(iaps) && iaps.length > 0) {
                    iapListContainer.innerHTML = `
                        <div style="display:grid;grid-template-columns:1fr;gap:.6rem;max-height:220px;overflow-y:auto;padding-right:.3rem">
                            ${iaps.map(item => `
                                <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:.7rem .9rem;display:flex;justify-content:space-between;align-items:center;gap:.8rem">
                                    <div>
                                        <strong style="color:#f8fafc;font-size:.9rem">${this.escapeHtml(item.title)}</strong>
                                        <div style="font-size:.78rem;color:#94a3b8;margin-top:.15rem">${this.escapeHtml(item.description || (item.purchase_type === 'managedUser' ? 'Item dalam game' : 'Langganan berkala'))}</div>
                                    </div>
                                    <span style="color:#f59e0b;font-weight:700;font-size:.95rem;white-space:nowrap">${this.escapeHtml(item.formatted_price || 'Tersedia')}</span>
                                </div>
                            `).join('')}
                        </div>
                    `;
                    return;
                }
            }
            iapListContainer.innerHTML = '<div style="font-size:.84rem;color:#94a3b8;font-style:italic">Tidak ada item In-App Purchase khusus atau game ini 100% gratis dimainkan! 🎮</div>';
        } catch (_) {
            iapListContainer.innerHTML = '<div style="font-size:.84rem;color:#94a3b8">Game gratis dimainkan langsung di Google Play.</div>';
        }
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    escapeHtml(text) {
        if (typeof text !== 'string') {
            text = String(text ?? '');
        }
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
}

// Initialize games loader when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new GamesLoader();
});
