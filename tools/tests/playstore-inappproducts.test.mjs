import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    formatPriceMicros,
    mapInAppProduct,
    parseInAppProductsResponse,
    summarizeInAppProducts
} = require('../inappproducts-utils.js');

test('formatPriceMicros correctly formats micro currency units', () => {
    assert.equal(formatPriceMicros('15000000000', 'IDR'), 'Rp 15.000');
    assert.equal(formatPriceMicros('990000', 'USD'), '$0.99');
    assert.equal(formatPriceMicros('4990000', 'USD'), '$4.99');
    assert.equal(formatPriceMicros(null, 'IDR'), '—');
});

test('mapInAppProduct correctly parses Google Play InAppProduct resource', () => {
    const raw = {
        packageName: 'com.MainraGames.Popit3DFidget',
        sku: 'remove_ads_permanent',
        status: 'active',
        purchaseType: 'managedUser',
        defaultPrice: {
            priceMicros: '15000000000',
            currency: 'IDR'
        },
        prices: {
            ID: { priceMicros: '15000000000', currency: 'IDR' },
            US: { priceMicros: '990000', currency: 'USD' }
        },
        listings: {
            'en-US': {
                title: 'Remove Ads',
                description: 'Remove all banner and interstitial ads forever.'
            },
            'id-ID': {
                title: 'Hapus Iklan Permanen',
                description: 'Nikmati permainan tanpa gangguan iklan selamanya.'
            }
        },
        defaultLanguage: 'en-US'
    };

    const mapped = mapInAppProduct(raw, 'com.MainraGames.Popit3DFidget');

    assert.equal(mapped.sku, 'remove_ads_permanent');
    assert.equal(mapped.game_id, 'com.MainraGames.Popit3DFidget');
    assert.equal(mapped.status, 'active');
    assert.equal(mapped.purchase_type, 'managedUser');
    assert.equal(mapped.title, 'Remove Ads');
    assert.equal(mapped.description, 'Remove all banner and interstitial ads forever.');
    assert.equal(mapped.price_micros, '15000000000');
    assert.equal(mapped.currency, 'IDR');
    assert.equal(mapped.formatted_price.includes('15.000'), true);
    assert.equal(mapped.listings['id-ID'].title, 'Hapus Iklan Permanen');
    assert.equal(mapped.prices['US'].currency, 'USD');
});

test('parseInAppProductsResponse filters and parses array of inapp products', () => {
    const rawResponse = {
        inappproduct: [
            {
                packageName: 'com.game.one',
                sku: 'coins_100',
                status: 'active',
                purchaseType: 'managedUser',
                defaultPrice: { priceMicros: '10000000000', currency: 'IDR' },
                listings: { 'en-US': { title: '100 Coins', description: 'Pack of 100 coins' } }
            },
            {
                packageName: 'com.game.one',
                sku: 'vip_monthly',
                status: 'active',
                purchaseType: 'subscription',
                defaultPrice: { priceMicros: '50000000000', currency: 'IDR' },
                listings: { 'en-US': { title: 'VIP Pass', description: 'Monthly VIP Perks' } }
            }
        ]
    };

    const parsed = parseInAppProductsResponse(rawResponse, 'com.game.one');
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].sku, 'coins_100');
    assert.equal(parsed[1].purchase_type, 'subscription');

    const summary = summarizeInAppProducts(parsed);
    assert.equal(summary.totalProducts, 2);
    assert.equal(summary.activeCount, 2);
    assert.equal(summary.managedCount, 1);
    assert.equal(summary.subscriptionCount, 1);
});
