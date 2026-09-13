/**
 * Helper utilities for Google Play Voided Purchases API (refunds, cancellations, fraud/chargebacks).
 */

const VOIDED_REASONS = {
    0: 'Other',
    1: 'Remorse (User Regret)',
    2: 'Not Received',
    3: 'Defective',
    4: 'Accidental Purchase',
    5: 'Fraud',
    6: 'Friendly Fraud',
    7: 'Chargeback',
    8: 'Unacknowledged Purchase'
};

const VOIDED_SOURCES = {
    0: 'User',
    1: 'Developer',
    2: 'Google'
};

function getVoidedReasonLabel(code) {
    if (typeof code !== 'number' && typeof code !== 'string') return 'Unknown';
    const num = Number(code);
    return VOIDED_REASONS[num] || `Unknown (${code})`;
}

function getVoidedSourceLabel(code) {
    if (typeof code !== 'number' && typeof code !== 'string') return 'Unknown';
    const num = Number(code);
    return VOIDED_SOURCES[num] || `Unknown (${code})`;
}

function mapVoidedPurchase(raw, gameId) {
    if (!raw) return null;
    const orderId = raw.orderId || raw.order_id || '';
    const purchaseToken = raw.purchaseToken || raw.purchase_token || '';
    const purchaseTime = raw.purchaseTimeMillis ? Number(raw.purchaseTimeMillis) : null;
    const voidedTime = raw.voidedTimeMillis ? Number(raw.voidedTimeMillis) : null;
    const voidedSource = raw.voidedSource != null ? Number(raw.voidedSource) : null;
    const voidedReason = raw.voidedReason != null ? Number(raw.voidedReason) : null;
    const voidedQuantity = raw.voidedQuantity != null ? Number(raw.voidedQuantity) : 1;

    // Fraud or chargeback flags (reasons 5: Fraud, 6: Friendly Fraud, 7: Chargeback)
    const isFraudOrChargeback = voidedReason === 5 || voidedReason === 6 || voidedReason === 7;

    return {
        order_id: orderId,
        game_id: gameId,
        purchase_token: purchaseToken,
        purchase_time_millis: purchaseTime,
        voided_time_millis: voidedTime,
        voided_source: voidedSource,
        voided_source_label: getVoidedSourceLabel(voidedSource),
        voided_reason: voidedReason,
        voided_reason_label: getVoidedReasonLabel(voidedReason),
        voided_quantity: voidedQuantity,
        is_fraud_or_chargeback: isFraudOrChargeback,
        raw_payload: raw,
        synced_at: new Date().toISOString()
    };
}

function parseVoidedPurchasesResponse(res, gameId) {
    const list = (res && (res.voidedPurchases || res.voided_purchases)) || [];
    return list.map(item => mapVoidedPurchase(item, gameId)).filter(Boolean);
}

function summarizeVoidedPurchases(records) {
    const list = records || [];
    let fraudOrChargebackCount = 0;
    const bySource = {};
    const byReason = {};

    list.forEach(r => {
        if (r.is_fraud_or_chargeback) fraudOrChargebackCount++;

        const src = r.voided_source_label || getVoidedSourceLabel(r.voided_source);
        bySource[src] = (bySource[src] || 0) + 1;

        const rsn = r.voided_reason_label || getVoidedReasonLabel(r.voided_reason);
        byReason[rsn] = (byReason[rsn] || 0) + 1;
    });

    return {
        totalVoided: list.length,
        fraudOrChargebackCount,
        bySource,
        byReason
    };
}

module.exports = {
    VOIDED_REASONS,
    VOIDED_SOURCES,
    getVoidedReasonLabel,
    getVoidedSourceLabel,
    mapVoidedPurchase,
    parseVoidedPurchasesResponse,
    summarizeVoidedPurchases
};
