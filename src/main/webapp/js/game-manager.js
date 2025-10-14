// Safe initializer for GamesLoader (no admin actions here)
document.addEventListener('DOMContentLoaded', function () {
  try {
    if (typeof window.GamesLoader === 'function' && !window.gamesLoader) {
      window.gamesLoader = new GamesLoader();
    } else if (window.gamesLoader && typeof window.gamesLoader.renderGames === 'function') {
      window.gamesLoader.renderGames();
    }
  } catch (e) {
    console.error('GamesLoader init error:', e);
  }
});
