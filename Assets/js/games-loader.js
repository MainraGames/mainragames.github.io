class GamesLoader {
    constructor() {
        this.games = [];
        this.highlight = null;
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
            const data = await response.json();
            this.games = data.games || [];
            this.highlight = data.highlight || null;
        } catch (error) {
            console.error('Error loading games from JSON:', error);

            // Default fallback data with new structure
            this.games = [
                {
                    id: 1,
                    title: "Adventure Quest",
                    description: "A 2D adventure game with unique mechanics and an engaging storyline",
                    image: "https://placehold.co/600x400/8a2be2/ffffff?text=Adventure+Quest",
                    screenshots: [
                        "https://placehold.co/600x400/8a2be2/ffffff?text=Adventure+Quest+1",
                        "https://placehold.co/600x400/7c3aed/ffffff?text=Adventure+Quest+2"
                    ],
                    playLink: "#",
                    category: "Adventure",
                    status: "Released",
                    releaseDate: "2024-01-15",
                    featured: true,
                    platform: "PC, Mobile",
                    rating: "4.8"
                },
                {
                    id: 2,
                    title: "Space Defender",
                    description: "A space shooter with stunning visuals",
                    image: "https://placehold.co/600x400/ff6b6b/ffffff?text=Space+Defender",
                    screenshots: [
                        "https://placehold.co/600x400/ff6b6b/ffffff?text=Space+Defender+1",
                        "https://placehold.co/600x400/ef4444/ffffff?text=Space+Defender+2"
                    ],
                    playLink: "#",
                    category: "Shooter",
                    status: "Released",
                    releaseDate: "2024-02-20",
                    featured: true,
                    platform: "PC, Console",
                    rating: "4.9"
                },
                {
                    id: 3,
                    title: "Mystic Worlds",
                    description: "An RPG set in a vast fantasy world featuring a diverse cast of characters",
                    image: "https://placehold.co/600x400/4cc9f0/ffffff?text=Mystic+Worlds",
                    screenshots: [
                        "https://placehold.co/600x400/4cc9f0/ffffff?text=Mystic+Worlds+1",
                        "https://placehold.co/600x400/0ea5e9/ffffff?text=Mystic+Worlds+2"
                    ],
                    playLink: "#",
                    category: "RPG",
                    status: "In Development",
                    releaseDate: "2024-06-01",
                    featured: true,
                    platform: "PC, Mobile",
                    rating: "4.7"
                }
            ];

            // Default highlight data
            this.highlight = {
                gameId: 2,
                customTitle: "",
                customDescription: "",
                youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                stats: {
                    gameplay: "100+",
                    characters: "50+",
                    worlds: "10+"
                },
                active: true,
                lastUpdated: "2024-01-15T10:00:00Z"
            };
        }
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
            return (b.id || 0) - (a.id || 0);
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
            
            return `
            <div class="game-item simple-card" ${game.playLink && game.playLink !== '#' ? `onclick="window.open('${game.playLink}', '_blank')" style="cursor:pointer;"` : ''}>
                <img src="${gameIcon}" alt="${this.escapeHtml(game.title)}" class="game-img" onerror="this.src='https://placehold.co/600x400/333/fff?text=No+Image'">
                <h3 class="game-title">${this.escapeHtml(game.title)}</h3>
            </div>
            `;
        }).join('');

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
        const highlightGame = this.games.find(game => game.id == highlightData.gameId);
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
        if (highlightText) {
            highlightText.innerHTML = `
                <h2>${this.escapeHtml(displayTitle)}</h2>
                ${formattedDescription}
                <div class="game-actions">
                    ${highlightGame.playLink && highlightGame.playLink !== '#' ? 
                        `<a href="${highlightGame.playLink}" target="_blank" class="btn btn-play"><i class="fas fa-play"></i> Play</a>` : ''
                    }
                    ${highlightData.youtubeUrl ? 
                        `<a href="${highlightData.youtubeUrl}" target="_blank" class="btn btn-details"><i class="fab fa-youtube"></i> Trailer</a>` : ''
                    }
                </div>
            `;
        }

        // Update carousel with game screenshots
        if (highlightImage && highlightGame.screenshots && highlightGame.screenshots.length > 0) {
            const slides = highlightGame.screenshots.map((screenshot, index) => `
                <div class="carousel-slide ${index === 0 ? 'active' : ''}">
                    <img src="${screenshot}" alt="${this.escapeHtml(displayTitle)} Screenshot ${index + 1}" onerror="this.src='${highlightGame.image}'">
                </div>
            `).join('');

            const dots = highlightGame.screenshots.map((_, index) => `
                <span class="dot ${index === 0 ? 'active' : ''}" onclick="currentSlide(${index + 1})"></span>
            `).join('');

            highlightImage.innerHTML = slides;
            const dotsContainer = document.querySelector('.carousel-dots');
            if (dotsContainer) {
                dotsContainer.innerHTML = dots;
            }
        } else {
            // Use main game image as single slide
            if (highlightImage) {
                highlightImage.innerHTML = `
                    <div class="carousel-slide active">
                        <img src="${highlightGame.image}" alt="${this.escapeHtml(displayTitle)}" onerror="this.src='https://placehold.co/600x400/333/fff?text=No+Image'">
                    </div>
                `;
            }

            const dotsContainer = document.querySelector('.carousel-dots');
            if (dotsContainer) {
                dotsContainer.innerHTML = '<span class="dot active"></span>';
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
                    <img src="${gameIcon}" alt="${this.escapeHtml(game.title)}" onerror="this.src='https://placehold.co/256x256/333/fff?text=No+Image'">
                </div>
                <div class="game-content">
                    <h3 class="game-title">${this.escapeHtml(game.title)}</h3>
                    <div class="game-meta">
                        <span class="game-platform">${this.escapeHtml(game.platform || 'Multi Platform')}</span>
                        ${game.rating ? `<span class="game-rating">${'★'.repeat(Math.floor(game.rating))} ${game.rating}/5</span>` : ''}
                    </div>
                    <div class="game-actions">
                        ${game.playLink && game.playLink !== '#' ? 
                            `<a href="${game.playLink}" target="_blank" class="btn btn-play">Play</a>` :
                            `<span class="btn" style="opacity: 0.5; cursor: not-allowed;">Coming Soon</span>`
                        }
                        <a href="#" class="btn btn-details">Details</a>
                    </div>
                </div>
            </div>
            `;
        }).join('');
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
