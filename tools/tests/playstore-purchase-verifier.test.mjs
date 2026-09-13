import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  validatePurchaseTokenPayload,
  parsePurchaseVerification
} = require('../purchase-verifier-utils.js');

test('validatePurchaseTokenPayload rejects invalid or missing fields', () => {
  assert.equal(validatePurchaseTokenPayload({}).valid, false);
  assert.equal(validatePurchaseTokenPayload({ packageName: 'com.test' }).valid, false);
  assert.equal(validatePurchaseTokenPayload({
    packageName: 'com.test',
    productId: 'remove_ads',
    purchaseToken: 'tok_123'
  }).valid, true);
});

test('parsePurchaseVerification correctly identifies purchase state and acknowledgment', () => {
  const verifiedPurchased = parsePurchaseVerification({
    purchaseState: 0, // 0 = Purchased
    consumptionState: 0, // Yet to be consumed
    acknowledgementState: 1, // 1 = Acknowledged
    purchaseTimeMillis: '1694560000000',
    orderId: 'GPA.1234-5678-9012'
  });

  assert.equal(verifiedPurchased.status, 'VALID');
  assert.equal(verifiedPurchased.isPurchased, true);
  assert.equal(verifiedPurchased.isAcknowledged, true);
  assert.equal(verifiedPurchased.orderId, 'GPA.1234-5678-9012');

  const canceledPurchase = parsePurchaseVerification({
    purchaseState: 1, // 1 = Canceled
    acknowledgementState: 0
  });

  assert.equal(canceledPurchase.status, 'CANCELED');
  assert.equal(canceledPurchase.isPurchased, false);
});
