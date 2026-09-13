/**
 * Helper utilities to parse Google Play Developer API tracks and releases.
 */

function parseTrackReleases(tracksResponse) {
    const tracksList = (tracksResponse && tracksResponse.tracks) || [];
    const result = {};

    for (const item of tracksList) {
        if (!item || !item.track) continue;
        const trackName = item.track;
        const releases = item.releases || [];

        // Find current/active release (prefer inProgress or completed)
        const activeRelease = releases.find(r => r.status === 'inProgress') ||
                              releases.find(r => r.status === 'completed') ||
                              releases[0] || null;

        if (!activeRelease) {
            result[trackName] = {
                track: trackName,
                currentRelease: null,
                releases: []
            };
            continue;
        }

        const notesMap = {};
        if (Array.isArray(activeRelease.releaseNotes)) {
            for (const n of activeRelease.releaseNotes) {
                if (n && n.language && n.text) {
                    notesMap[n.language] = n.text;
                }
            }
        }

        let rolloutPct = 100;
        if (typeof activeRelease.userFraction === 'number') {
            rolloutPct = Math.round(activeRelease.userFraction * 100);
        } else if (activeRelease.status === 'inProgress') {
            rolloutPct = 0;
        }

        result[trackName] = {
            track: trackName,
            currentRelease: {
                name: activeRelease.name || null,
                versionCode: (activeRelease.versionCodes && activeRelease.versionCodes[0]) || null,
                versionCodes: activeRelease.versionCodes || [],
                status: activeRelease.status || 'unknown',
                userFraction: typeof activeRelease.userFraction === 'number' ? activeRelease.userFraction : 1.0,
                rolloutPercentage: rolloutPct,
                notes: notesMap
            },
            releases: releases.map(r => ({
                name: r.name || null,
                versionCodes: r.versionCodes || [],
                status: r.status || null,
                userFraction: typeof r.userFraction === 'number' ? r.userFraction : null
            }))
        };
    }

    return result;
}

module.exports = {
    parseTrackReleases
};
