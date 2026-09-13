/**
 * Shared robustness helpers for the tools/ sync scripts.
 */

/**
 * Throws when an HTTP response is not ok and returns it otherwise.
 *
 * Without this, a 401/500 body was parsed as JSON and treated as an empty
 * result set, so "the API rejected us" looked identical to "there is no data
 * yet" — and the cron job stayed green while syncing nothing.
 */
async function assertOkResponse(res, label) {
    if (res.ok) return res;

    let detail = '';
    try {
        detail = String(await res.text()).slice(0, 300);
    } catch (_) {
        // body already consumed or empty
    }

    throw new Error(`${label} request failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Counts per-item outcomes so a partially failed sync run exits non-zero
 * instead of reporting success.
 */
function createSyncTally(label, log = console.log) {
    let attempted = 0;
    let failed = 0;

    return {
        attempt() {
            attempted += 1;
        },
        failure() {
            failed += 1;
        },
        finish() {
            const synced = attempted - failed;
            log(`[${label}] ${synced}/${attempted} item(s) synced${failed ? `, ${failed} failed` : ''}.`);
            return { attempted, failed, exitCode: failed > 0 ? 1 : 0 };
        },
    };
}

module.exports = { assertOkResponse, createSyncTally };
