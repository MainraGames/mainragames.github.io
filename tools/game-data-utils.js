const crypto = require('crypto');
const fs = require('fs');

const TRUSTED_ASSET_HOSTS = new Set(['play-lh.googleusercontent.com']);

function getStableGameId(appId) {
    if (typeof appId !== 'string' || !appId.trim()) {
        throw new Error('Game appId is required for a stable game ID');
    }

    return appId.trim();
}

function isHttpsUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;

    try {
        return new URL(value.trim()).protocol === 'https:';
    } catch {
        return false;
    }
}

function isTrustedAssetUrl(value) {
    if (!isHttpsUrl(value)) return false;

    return TRUSTED_ASSET_HOSTS.has(new URL(value.trim()).hostname);
}

function isPlayStoreUrl(value, appId) {
    if (!isHttpsUrl(value)) return false;

    const url = new URL(value.trim());
    return url.hostname === 'play.google.com' &&
        url.pathname === '/store/apps/details' &&
        url.searchParams.get('id') === appId;
}

function validateGames(games) {
    if (!Array.isArray(games) || games.length === 0) {
        throw new Error('Scraper returned no games; refusing to overwrite games-data.json');
    }

    const ids = new Set();
    for (const [index, game] of games.entries()) {
        if (!game || typeof game !== 'object') {
            throw new Error(`Invalid game at index ${index}`);
        }
        if (typeof game.appId !== 'string' || !game.appId.trim()) {
            throw new Error(`Game at index ${index} has no appId`);
        }
        if (game.id !== getStableGameId(game.appId)) {
            throw new Error(`Game at index ${index} has an ID that does not match its appId`);
        }
        if (ids.has(game.id)) {
            throw new Error(`Duplicate game ID at index ${index}`);
        }
        ids.add(game.id);
        if (typeof game.title !== 'string' || !game.title.trim()) {
            throw new Error(`Game at index ${index} has no title`);
        }
        if (!isPlayStoreUrl(game.playLink, game.appId)) {
            throw new Error(`Game at index ${index} has an invalid playLink`);
        }
        if (game.image && !isTrustedAssetUrl(game.image)) {
            throw new Error(`Game at index ${index} has an untrusted image URL`);
        }
        if (!Array.isArray(game.screenshots) || game.screenshots.some(url => !isTrustedAssetUrl(url))) {
            throw new Error(`Game at index ${index} has untrusted screenshots`);
        }
    }

    return games;
}

function readGamesData(filePath) {
    if (!fs.existsSync(filePath)) return { games: [], highlight: null };

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
        games: Array.isArray(data.games) ? data.games : [],
        highlight: data.highlight || null
    };
}

function resolveHighlightGameId(existingData, newGames) {
    const existingHighlightId = existingData?.highlight?.gameId;
    if (existingHighlightId === undefined || existingHighlightId === null) return null;

    const existingGame = (existingData.games || []).find(game => String(game.id) === String(existingHighlightId));
    const existingAppId = existingGame?.appId;
    const matchingGame = newGames.find(game =>
        String(game.id) === String(existingHighlightId) ||
        (existingAppId && game.appId === existingAppId)
    );

    return matchingGame?.id || null;
}

function writeGamesData(filePath, data) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;

    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
        try {
            fs.renameSync(temporaryPath, filePath);
        } catch {
            // Windows cannot replace an existing file with renameSync; this fallback is not atomic.
            try {
                fs.copyFileSync(temporaryPath, filePath);
            } finally {
                fs.rmSync(temporaryPath, { force: true });
            }
        }
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }
}

module.exports = {
    getStableGameId,
    isHttpsUrl,
    isPlayStoreUrl,
    isTrustedAssetUrl,
    readGamesData,
    resolveHighlightGameId,
    validateGames,
    writeGamesData
};
