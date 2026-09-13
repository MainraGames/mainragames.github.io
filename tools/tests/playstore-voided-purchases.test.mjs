import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    mapVoidedPurchase,
    parseVoidedPurchasesResponse,
    getVoidedReasonLabel,
    getVoidedSourceLabel,
    summarizeVoidedPurchases
} = require('../voided-purchases-utils.js');

test('getVoidedReasonLabel translates reason codes accurately', () => {
    assert.equal(getVoidedReasonLabel(0), 'Other');
    assert.equal(getVoidedReasonLabel(1), 'Remorse (User Regret)');
    assert.equal(getVoidedReasonLabel(4), 'Accidental Purchase');
    assert.equal(getVoidedReasonLabel(5), 'Fraud');
    assert.equal(getVoidedReasonLabel(6), 'Friendly Fraud');
    assert.equal(getVoidedReasonLabel(7), 'Chargeback');
    assert.equal(getVoidedReasonLabel(8), 'Unacknowledged Purchase');
    assert.equal(getVoidedReasonLabel(999), 'Unknown (999)');
});

test('getVoidedSourceLabel translates initiator codes accurately', () => {
    assert.equal(getVoidedSourceLabel(0), 'User');
    assert.equal(getVoidedSourceLabel(1), 'Developer');
    assert.equal(getVoidedSourceLabel(2), 'Google');
    assert.equal(getVoidedSourceLabel(99), 'Unknown (99)');
});

test('mapVoidedPurchase correctly maps Google Play API item to database record', () => {
    const rawItem = {
        kind: 'androidpublisher#voidedPurchase',
        orderId: 'GPA.1234-5678-9012-34567',
        purchaseToken: 'token_abc_123',
        purchaseTimeMillis: '1700000000000',
        voidedTimeMillis: '1700500000000',
        voidedSource: 0,
        voidedReason: 5,
        voidedQuantity: 1
    };

    const mapped = mapVoidedPurchase(rawItem, 'com.MainraGames.SquishyJellyMerge');

    assert.equal(mapped.order_id, 'GPA.1234-5678-9012-34567');
    assert.equal(mapped.game_id, 'com.MainraGames.SquishyJellyMerge');
    assert.equal(mapped.purchase_token, 'token_abc_123');
    assert.equal(mapped.purchase_time_millis, 1700000000000);
    assert.equal(mapped.voided_time_millis, 1700500000000);
    assert.equal(mapped.voided_source, 0);
    assert.equal(mapped.voided_source_label, 'User');
    assert.equal(mapped.voided_reason, 5);
    assert.equal(mapped.voided_reason_label, 'Fraud');
    assert.equal(mapped.voided_quantity, 1);
    assert.equal(mapped.is_fraud_or_chargeback, true);
});

test('summarizeVoidedPurchases aggregates fraud risk and refund metrics', () => {
    const records = [
        {
            order_id: 'GPA.1',
            game_id: 'com.game.one',
            voided_reason: 1, // Remorse
            voided_source: 0,
            is_fraud_or_chargeback: false
        },
        {
            order_id: 'GPA.2',
            game_id: 'com.game.one',
            voided_reason: 5, // Fraud
            voided_source: 2, // Google
            is_fraud_or_chargeback: true
        },
        {
            order_id: 'GPA.3',
            game_id: 'com.game.two',
            voided_reason: 7, // Chargeback
            voided_source: 0, // User
            is_fraud_or_chargeback: true
        }
    ];

    const summary = summarizeVoidedPurchases(records);

    assert.equal(summary.totalVoided, 3);
    assert.equal(summary.fraudOrChargebackCount, 2);
    assert.equal(summary.bySource.User, 2);
    assert.equal(summary.bySource.Google, 1);
    assert.equal(summary.byReason['Fraud'], 1);
    assert.equal(summary.byReason['Chargeback'], 1);
    assert.equal(summary.byReason['Remorse (User Regret)'], 1);
});
