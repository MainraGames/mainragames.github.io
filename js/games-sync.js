class GamesSync {
    constructor() {
        this.setupSyncListeners();
        this.requestSyncFromAdmin();
    }

    setupSyncListeners() {
        // BroadcastChannel for cross-tab communication
        if (typeof BroadcastChannel !== 'undefined') {
            this.syncChannel = new BroadcastChannel('mainra-games-sync');
            this.syncChannel.addEventListener('message', (event) => {
                if (event.data.type === 'games-updated' && event.data.source === 'admin') {
                    this.updateGamesDisplay(event.data.data);
                    this.showSyncNotification('Games updated from admin panel');
                }
            });
        }

        // Custom event for same-page updates
        window.addEventListener('mainra-games-updated', (event) => {
            if (event.detail.source === 'admin') {
                this.updateGamesDisplay(event.detail.data);
            }
        });
    }

    requestSyncFromAdmin() {
        // Request latest data from admin if it's open in another tab
        if (typeof BroadcastChannel !== 'undefined') {
            this.syncChannel.postMessage({
                type: 'request-sync',
                source: 'games-page',
                timestamp: Date.now()
            });
        }
    }

    updateGamesDisplay(data) {
        if (typeof window.gamesLoader !== 'undefined' && window.gamesLoader) {
            window.gamesLoader.games = data.games || [];
            window.gamesLoader.highlight = data.highlight || null;
            window.gamesLoader.renderGames();
        } else if (typeof GamesLoader === 'function') {
            window.gamesLoader = new GamesLoader();
            window.gamesLoader.games = data.games || [];
            window.gamesLoader.highlight = data.highlight || null;
            window.gamesLoader.renderGames();
        }
    }

    showSyncNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'sync-notification';
        notification.innerHTML = `
            <i class="fas fa-sync-alt"></i>
            <span>${message}</span>
        `;
        Object.assign(notification.style, {
            position: 'fixed',
            top: '2rem',
            right: '2rem',
            background: 'linear-gradient(45deg, #28a745, #20c997)',
            color: '#fff',
            padding: '1rem 1.5rem',
            borderRadius: '25px',
            boxShadow: '0 4px 20px rgba(0,0,0,.3)',
            zIndex: '9999',
            display: 'flex',
            alignItems: 'center',
            gap: '.5rem',
            fontWeight: '600',
            transform: 'translateX(100%)',
            transition: 'all .3s ease'
        });
        document.body.appendChild(notification);
        setTimeout(() => { notification.style.transform = 'translateX(0)'; }, 100);
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Auto init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { window.gamesSync = new GamesSync(); });
} else {
    window.gamesSync = new GamesSync();
}
