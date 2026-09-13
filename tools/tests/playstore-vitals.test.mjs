import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    assessVitalsHealth,
    CRASH_RATE_BAD_BEHAVIOR_THRESHOLD,
    ANR_RATE_BAD_BEHAVIOR_THRESHOLD,
    parseVitalsQueryResponse,
    formatRatePercent
} = require('../vitals-utils.js');

test('assessVitalsHealth correctly identifies normal, warning, and critical thresholds', () => {
    // 1. Normal/Healthy case (Crash < 0.8%, ANR < 0.35%)
    const normal = assessVitalsHealth(0.0025, 0.0010);
    assert.equal(normal.status, 'healthy');
    assert.equal(normal.crashNearThreshold, false);
    assert.equal(normal.anrNearThreshold, false);
    assert.equal(normal.crashExceededThreshold, false);

    // 2. Warning case (approaching bad behavior threshold 1.09% e.g. >= 0.85%)
    const warningCrash = assessVitalsHealth(0.0095, 0.0020);
    assert.equal(warningCrash.status, 'warning');
    assert.equal(warningCrash.crashNearThreshold, true);
    assert.equal(warningCrash.crashExceededThreshold, false);
    assert.match(warningCrash.message, /mendekati ambang batas/i);

    // 3. Critical case (Exceeded threshold: crash >= 1.09% or ANR >= 0.47%)
    const criticalCrash = assessVitalsHealth(0.0125, 0.0020);
    assert.equal(criticalCrash.status, 'critical');
    assert.equal(criticalCrash.crashExceededThreshold, true);
    assert.match(criticalCrash.message, /melebihi ambang batas buruk/i);

    const criticalAnr = assessVitalsHealth(0.0030, 0.0055);
    assert.equal(criticalAnr.status, 'critical');
    assert.equal(criticalAnr.anrExceededThreshold, true);
});

test('parseVitalsQueryResponse extracts latest metric decimal values correctly', () => {
    const rawCrashResponse = {
        rows: [
            {
                metrics: [
                    { metric: 'crashRate', decimalValue: { value: '0.004215' } },
                    { metric: 'distinctUsers', decimalValue: { value: '1420' } }
                ]
            }
        ]
    };

    const parsed = parseVitalsQueryResponse(rawCrashResponse, 'crashRate');
    assert.equal(parsed.rate, 0.004215);
    assert.equal(parsed.distinctUsers, 1420);
});

test('formatRatePercent correctly formats percentages', () => {
    assert.equal(formatRatePercent(0.0109), '1.09%');
    assert.equal(formatRatePercent(0.004215), '0.42%');
    assert.equal(formatRatePercent(null), '0.00%');
});
