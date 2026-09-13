import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    validateListingPayload,
    mapStoreListing,
    parseStoreListingsResponse,
    mergeListingIntoGame
} = require('../store-listings-utils.js');

test('validateListingPayload enforces Google Play Store character limits', () => {
    // Valid listing
    const valid = {
        language: 'id-ID',
        title: 'Pop It 3D Fidget',
        shortDescription: 'Game santai meletuskan balon pop it 3D seru!',
        fullDescription: 'Nikmati permainan pop it 3D terbaik dengan banyak pilihan bentuk dan warna cerah.'
    };
    const validResult = validateListingPayload(valid);
    assert.equal(validResult.valid, true);

    // Title exceeds 30 chars (Google Play limit)
    const longTitle = {
        ...valid,
        title: 'Pop It 3D Fidget Multiplayer Game Studio Mainra'
    };
    const longTitleResult = validateListingPayload(longTitle);
    assert.equal(longTitleResult.valid, false);
    assert.match(longTitleResult.error, /Title exceeds 30 characters/);

    // Short description exceeds 80 chars
    const longShortDesc = {
        ...valid,
        shortDescription: 'Game santai meletuskan balon pop it 3D seru dengan visual memukau dan efek suara ASMR yang sangat menenangkan pikiran.'
    };
    const longShortResult = validateListingPayload(longShortDesc);
    assert.equal(longShortResult.valid, false);
    assert.match(longShortResult.error, /Short description exceeds 80 characters/);

    // Missing language
    const noLang = { title: 'Test', shortDescription: 'Short', fullDescription: 'Full' };
    const noLangResult = validateListingPayload(noLang);
    assert.equal(noLangResult.valid, false);
    assert.match(noLangResult.error, /Language code is required/);
});

test('mapStoreListing correctly parses Google Play listing resource', () => {
    const raw = {
        language: 'en-US',
        title: 'Pop It 3D Fidget',
        shortDescription: 'Pop bubbles in 3D!',
        fullDescription: 'Enjoy soothing 3D sensory fidget toys.',
        video: 'https://www.youtube.com/watch?v=sample123'
    };

    const mapped = mapStoreListing(raw, 'com.MainraGames.Popit3DFidget');
    assert.equal(mapped.id, 'com.MainraGames.Popit3DFidget:en-US');
    assert.equal(mapped.game_id, 'com.MainraGames.Popit3DFidget');
    assert.equal(mapped.language, 'en-US');
    assert.equal(mapped.title, 'Pop It 3D Fidget');
    assert.equal(mapped.short_description, 'Pop bubbles in 3D!');
    assert.equal(mapped.video, 'https://www.youtube.com/watch?v=sample123');
});

test('parseStoreListingsResponse and mergeListingIntoGame correctly selects primary metadata', () => {
    const rawResponse = {
        listings: [
            {
                language: 'en-US',
                title: 'Pop It 3D (US)',
                shortDescription: 'US Short Description',
                fullDescription: 'US Full Description',
                video: 'https://youtube.com/watch?v=us'
            },
            {
                language: 'id-ID',
                title: 'Pop It 3D (ID)',
                shortDescription: 'Deskripsi Singkat Indonesia',
                fullDescription: 'Deskripsi Lengkap Indonesia',
                video: 'https://youtube.com/watch?v=id'
            }
        ]
    };

    const listings = parseStoreListingsResponse(rawResponse, 'com.MainraGames.Popit3DFidget');
    assert.equal(listings.length, 2);

    const merged = mergeListingIntoGame(listings, 'id-ID');
    assert.equal(merged.title, 'Pop It 3D (ID)');
    assert.equal(merged.short_description, 'Deskripsi Singkat Indonesia');
    assert.equal(merged.video_url, 'https://youtube.com/watch?v=id');
    assert.ok(merged.store_listings['en-US']);
    assert.ok(merged.store_listings['id-ID']);
});
