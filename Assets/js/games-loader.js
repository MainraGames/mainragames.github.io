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
                const fallback = this.safeUrl(image.dataset.fallbackSrc);
                if (fallback && image.src !== fallback) image.src = fallback;
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
        console.log('Latest games for homepage:', latestGames.length);

        if (latestGames.length === 0) {
            console.log('No games found, showing empty state');
            gamesGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #999;">
                    <i class="fas fa-gamepad" style="font-size: 4rem; margin-bottom: 1rem;"></i>
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
            const imageUrl = this.safeUrl(gameIcon, ['play-lh.googleusercontent.com', 'placehold.co']) || 'https://placehold.co/600x400/333/fff?text=No+Image';
            return `
            <div class="game-item simple-card" ${playLink ? `data-play-link="${this.escapeHtml(playLink)}" tabindex="0" role="link"` : ''}>
                <img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(game.title)}" class="game-img" data-fallback-src="https://placehold.co/600x400/333/fff?text=No+Image">
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
                        <i class="fas fa-crown" style="font-size: 4rem; margin-bottom: 1rem;"></i>
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
                        <i class="fas fa-exclamation-triangle" style="font-size: 4rem; margin-bottom: 1rem; color: var(--warning);"></i>
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
                        `<a href="${this.escapeHtml(playLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-play"><i class="fas fa-play"></i> Play</a>` : ''
                    }
                    ${trailerUrl ?
                        `<a href="${this.escapeHtml(trailerUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-details"><i class="fab fa-youtube"></i> Trailer</a>` : ''
                    }
                </div>
            `;
        }

        // Update carousel with game screenshots
        if (highlightImage && highlightGame.screenshots && highlightGame.screenshots.length > 0) {
            const fallbackImage = this.safeUrl(highlightGame.image, ['play-lh.googleusercontent.com', 'placehold.co']) || 'https://placehold.co/600x400/333/fff?text=No+Image';
            const slides = highlightGame.screenshots.map((screenshot, index) => {
                const screenshotUrl = this.safeUrl(screenshot, ['play-lh.googleusercontent.com']);
                if (!screenshotUrl) return '';
                return `
                <div class="carousel-slide ${index === 0 ? 'active' : ''}">
                    <img src="${this.escapeHtml(screenshotUrl)}" alt="${this.escapeHtml(displayTitle)} Screenshot ${index + 1}" data-fallback-src="${this.escapeHtml(fallbackImage)}">
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
                const imageUrl = this.safeUrl(highlightGame.image, ['play-lh.googleusercontent.com', 'placehold.co']) || 'https://placehold.co/600x400/333/fff?text=No+Image';
                highlightImage.innerHTML = `
                    <div class="carousel-slide active">
                        <img src="${this.escapeHtml(imageUrl)}" alt="${this.escapeHtml(displayTitle)}" data-fallback-src="https://placehold.co/600x400/333/fff?text=No+Image">
                    </div>
                `;
                this.bindImageFallbacks(highlightImage);
            }

            const dotsContainer = document.querySelector('.carousel-dots');
            if (dotsContainer) {
                dotsContainer.innerHTML = '<button type="button" class="dot active" aria-label="Current slide"></button>';
            }
        }
        try { if (typeof window.initializeCarousel === 'function') setTimeout(window.initializeCarousel, 50); } catch (e) {}
    }

    renderGamesPage() {
        const gamesList = document.querySelector('.games-list');
        if (!gamesList) return;

        if (this.games.length === 0) {
            gamesList.innerHTML = `
                <div class="no-games" style="text-align: center; padding: 3rem; color: #999;">
                    <i class="fas fa-gamepad" style="font-size: 4rem; margin-bottom: 1rem;"></i>
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
                gameIcon = 'https://placehold.co/256x256/333/fff?text=Game';
            }
            
            return `
            <div class="game-item">
                <div class="game-image">
                    <img src="${this.escapeHtml(this.safeUrl(gameIcon, ['play-lh.googleusercontent.com', 'placehold.co']) || 'https://placehold.co/256x256/333/fff?text=No+Image')}" alt="${this.escapeHtml(game.title)}" data-fallback-src="https://placehold.co/256x256/333/fff?text=No+Image">
                </div>
                <div class="game-content">
                    <h3 class="game-title">${this.escapeHtml(game.title)}</h3>
                    <div class="game-meta">
                        <span class="game-platform">${this.escapeHtml(game.platform || 'Multi Platform')}</span>
                        ${game.rating ? `<span class="game-rating">${'★'.repeat(Math.floor(game.rating))} ${game.rating}/5</span>` : ''}
                    </div>
                    <div class="game-actions">
                        ${playLink ?
                            `<a href="${this.escapeHtml(playLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-play">Play</a>` :
                            `<span class="btn" style="opacity: 0.5; cursor: not-allowed;">Coming Soon</span>`
                        }
                        <a href="#" class="btn btn-details">Details</a>
                    </div>
                </div>
            </div>
            `;
        }).join('');
        this.bindImageFallbacks(gamesList);
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
