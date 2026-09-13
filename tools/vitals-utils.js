/**
 * Utilities for Google Play Developer Reporting API (Android Vitals - Crash Rate & ANR Rate).
 */

// Google Play Bad Behavior Thresholds:
// Overall Bad Behavior Threshold for Crash Rate is 1.09% (0.0109)
// Overall Bad Behavior Threshold for ANR Rate is 0.47% (0.0047)
const CRASH_RATE_BAD_BEHAVIOR_THRESHOLD = 0.0109;
const ANR_RATE_BAD_BEHAVIOR_THRESHOLD = 0.0047;

// Warning thresholds (e.g. at ~80% of bad behavior threshold)
const CRASH_RATE_WARNING_THRESHOLD = 0.0085;
const ANR_RATE_WARNING_THRESHOLD = 0.0037;

function formatRatePercent(decimalVal) {
    if (decimalVal == null || isNaN(decimalVal)) return '0.00%';
    const pct = Number(decimalVal) * 100;
    return pct.toFixed(2) + '%';
}

function parseVitalsQueryResponse(queryResponse, metricKey = 'crashRate') {
    if (!queryResponse || !Array.isArray(queryResponse.rows) || queryResponse.rows.length === 0) {
        return { rate: null, distinctUsers: null };
    }

    const latestRow = queryResponse.rows[queryResponse.rows.length - 1];
    let rate = null;
    let distinctUsers = null;

    if (Array.isArray(latestRow.metrics)) {
        for (const m of latestRow.metrics) {
            if (m.metric === metricKey) {
                rate = m.decimalValue && m.decimalValue.value ? Number(m.decimalValue.value) : null;
            } else if (m.metric === 'distinctUsers') {
                distinctUsers = m.decimalValue && m.decimalValue.value ? Number(m.decimalValue.value) : null;
            }
        }
    }

    return { rate, distinctUsers };
}

function assessVitalsHealth(crashRate, anrRate) {
    const crash = Number(crashRate || 0);
    const anr = Number(anrRate || 0);

    const crashExceeded = crash >= CRASH_RATE_BAD_BEHAVIOR_THRESHOLD;
    const anrExceeded = anr >= ANR_RATE_BAD_BEHAVIOR_THRESHOLD;
    const crashNear = !crashExceeded && crash >= CRASH_RATE_WARNING_THRESHOLD;
    const anrNear = !anrExceeded && anr >= ANR_RATE_WARNING_THRESHOLD;

    if (crashExceeded || anrExceeded) {
        const issues = [];
        if (crashExceeded) issues.push(`Crash Rate (${formatRatePercent(crash)}) melebihi ambang batas buruk Google Play (1.09%)`);
        if (anrExceeded) issues.push(`ANR Rate (${formatRatePercent(anr)}) melebihi ambang batas buruk Google Play (0.47%)`);

        return {
            status: 'critical',
            crashRate: crash,
            anrRate: anr,
            crashNearThreshold: false,
            anrNearThreshold: false,
            crashExceededThreshold: crashExceeded,
            anrExceededThreshold: anrExceeded,
            message: `⚠️ Bahaya: ${issues.join(', ')}. Game berisiko diturunkan visibilitasnya di Play Store.`
        };
    }

    if (crashNear || anrNear) {
        const warnings = [];
        if (crashNear) warnings.push(`Crash Rate (${formatRatePercent(crash)}) mendekati ambang batas Play Store (1.09%)`);
        if (anrNear) warnings.push(`ANR Rate (${formatRatePercent(anr)}) mendekati ambang batas Play Store (0.47%)`);

        return {
            status: 'warning',
            crashRate: crash,
            anrRate: anr,
            crashNearThreshold: crashNear,
            anrNearThreshold: anrNear,
            crashExceededThreshold: false,
            anrExceededThreshold: false,
            message: `Perhatian: ${warnings.join(', ')}.`
        };
    }

    return {
        status: 'healthy',
        crashRate: crash,
        anrRate: anr,
        crashNearThreshold: false,
        anrNearThreshold: false,
        crashExceededThreshold: false,
        anrExceededThreshold: false,
        message: 'Kinerja aplikasi stabil & di bawah ambang batas Google Play (Sehat).'
    };
}

module.exports = {
    CRASH_RATE_BAD_BEHAVIOR_THRESHOLD,
    ANR_RATE_BAD_BEHAVIOR_THRESHOLD,
    CRASH_RATE_WARNING_THRESHOLD,
    ANR_RATE_WARNING_THRESHOLD,
    formatRatePercent,
    parseVitalsQueryResponse,
    assessVitalsHealth
};
