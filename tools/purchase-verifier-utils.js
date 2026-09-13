// tools/purchase-verifier-utils.js
// Utility helpers for Android Publisher API purchases.products.get and acknowledge

function validatePurchaseTokenPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }

  const { packageName, productId, purchaseToken } = payload;
  if (!packageName || typeof packageName !== 'string' || !packageName.trim()) {
    return { valid: false, error: 'packageName is required' };
  }
  if (!productId || typeof productId !== 'string' || !productId.trim()) {
    return { valid: false, error: 'productId is required' };
  }
  if (!purchaseToken || typeof purchaseToken !== 'string' || !purchaseToken.trim()) {
    return { valid: false, error: 'purchaseToken is required' };
  }

  return { valid: true };
}

function parsePurchaseVerification(productPurchase) {
  if (!productPurchase || typeof productPurchase !== 'object') {
    return {
      status: 'INVALID',
      isPurchased: false,
      isAcknowledged: false
    };
  }

  // purchaseState: 0 = Purchased, 1 = Canceled, 2 = Pending
  const isPurchased = productPurchase.purchaseState === 0;
  const isAcknowledged = productPurchase.acknowledgementState === 1;

  let status = 'UNKNOWN';
  if (productPurchase.purchaseState === 0) status = 'VALID';
  else if (productPurchase.purchaseState === 1) status = 'CANCELED';
  else if (productPurchase.purchaseState === 2) status = 'PENDING';

  return {
    status,
    isPurchased,
    isAcknowledged,
    orderId: productPurchase.orderId || null,
    purchaseTimeMillis: productPurchase.purchaseTimeMillis || null,
    consumptionState: productPurchase.consumptionState === 1 ? 'CONSUMED' : 'UNCONSUMED',
    developerPayload: productPurchase.developerPayload || null
  };
}

module.exports = {
  validatePurchaseTokenPayload,
  parsePurchaseVerification
};
