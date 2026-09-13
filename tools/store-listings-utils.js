/**
 * Utilities for Google Play Developer API Store Listings (edits.listings & edits.images).
 * Handles multi-language metadata, character limits validation, and sync payloads.
 */

// Official Google Play Store listing limits
const LIMITS = {
    TITLE_MAX: 30,
    SHORT_DESC_MAX: 80,
    FULL_DESC_MAX: 4000
};

function validateListingPayload(listing) {
    if (!listing) return { valid: false, error: 'Listing payload is required.' };
    const lang = (listing.language || '').trim();
    if (!lang) return { valid: false, error: 'Language code is required (e.g. "id-ID", "en-US").' };

    const title = (listing.title || '').trim();
    if (!title) return { valid: false, error: 'Title is required.' };
    if (title.length > LIMITS.TITLE_MAX) {
        return { valid: false, error: `Title exceeds ${LIMITS.TITLE_MAX} characters (current: ${title.length}).` };
    }

    const shortDesc = (listing.shortDescription || '').trim();
    if (shortDesc.length > LIMITS.SHORT_DESC_MAX) {
        return { valid: false, error: `Short description exceeds ${LIMITS.SHORT_DESC_MAX} characters (current: ${shortDesc.length}).` };
    }

    const fullDesc = (listing.fullDescription || '').trim();
    if (fullDesc.length > LIMITS.FULL_DESC_MAX) {
        return { valid: false, error: `Full description exceeds ${LIMITS.FULL_DESC_MAX} characters (current: ${fullDesc.length}).` };
    }

    return { valid: true };
}

function mapStoreListing(raw, gameId) {
    if (!raw) return null;
    const lang = raw.language || 'en-US';
    return {
        id: `${gameId}:${lang}`,
        game_id: gameId,
        language: lang,
        title: raw.title || '',
        short_description: raw.shortDescription || '',
        full_description: raw.fullDescription || '',
        video: raw.video || null,
        synced_at: new Date().toISOString()
    };
}

function parseStoreListingsResponse(res, gameId) {
    const list = (res && res.listings) || [];
    return list.map(item => mapStoreListing(item, gameId)).filter(Boolean);
}

function mergeListingIntoGame(listings, preferredLang = 'id-ID') {
    const list = listings || [];
    const storeListingsMap = {};
    list.forEach(l => {
        storeListingsMap[l.language] = {
            title: l.title,
            shortDescription: l.short_description,
            fullDescription: l.full_description,
            video: l.video
        };
    });

    const primary = list.find(l => l.language === preferredLang) ||
                    list.find(l => l.language.startsWith('id')) ||
                    list.find(l => l.language === 'en-US') ||
                    list[0] || {};

    return {
        title: primary.title || undefined,
        short_description: primary.short_description || '',
        description: primary.full_description || undefined,
        video_url: primary.video || undefined,
        store_listings: storeListingsMap
    };
}

module.exports = {
    LIMITS,
    validateListingPayload,
    mapStoreListing,
    parseStoreListingsResponse,
    mergeListingIntoGame
};
