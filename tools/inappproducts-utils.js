/**
 * Utilities for Google Play InAppProducts API (managed products, items, subscriptions)
 */

function formatPriceMicros(priceMicros, currency = 'USD') {
    if (!priceMicros) return '—';
    const micros = Number(priceMicros);
    if (isNaN(micros)) return '—';
    const amount = micros / 1000000;

    const locale = currency === 'IDR' ? 'id-ID' : 'en-US';
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currency,
            maximumFractionDigits: currency === 'IDR' ? 0 : 2
        }).format(amount);
    } catch (_) {
        return `${currency} ${amount.toFixed(2)}`;
    }
}

function mapInAppProduct(raw, gameId) {
    if (!raw) return null;
    const sku = raw.sku || '';
    const status = raw.status || 'active';
    const purchaseType = raw.purchaseType || 'managedUser';
    const defaultLanguage = raw.defaultLanguage || 'en-US';
    const listings = raw.listings || {};

    const listing = listings[defaultLanguage] || listings['en-US'] || listings['id-ID'] || Object.values(listings)[0] || {};
    const title = listing.title || sku;
    const description = listing.description || '';

    const defaultPrice = raw.defaultPrice || {};
    const priceMicros = defaultPrice.priceMicros || null;
    const currency = defaultPrice.currency || 'USD';
    const formattedPrice = formatPriceMicros(priceMicros, currency);

    return {
        game_id: gameId,
        sku: sku,
        status: status,
        purchase_type: purchaseType,
        title: title,
        description: description,
        price_micros: priceMicros,
        currency: currency,
        formatted_price: formattedPrice,
        prices: raw.prices || {},
        listings: listings,
        default_language: defaultLanguage,
        raw_payload: raw,
        synced_at: new Date().toISOString()
    };
}

function parseInAppProductsResponse(res, gameId) {
    const list = (res && (res.inappproduct || res.inappproducts)) || [];
    return list.map(item => mapInAppProduct(item, gameId)).filter(Boolean);
}

function summarizeInAppProducts(products) {
    const list = products || [];
    let activeCount = 0;
    let managedCount = 0;
    let subscriptionCount = 0;

    list.forEach(p => {
        if (p.status === 'active') activeCount++;
        if (p.purchase_type === 'managedUser') managedCount++;
        if (p.purchase_type === 'subscription') subscriptionCount++;
    });

    return {
        totalProducts: list.length,
        activeCount,
        managedCount,
        subscriptionCount
    };
}

module.exports = {
    formatPriceMicros,
    mapInAppProduct,
    parseInAppProductsResponse,
    summarizeInAppProducts
};
