import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseTrackReleases } = require('../tracks-utils.js');

test('parseTrackReleases parses active releases and calculates staged rollout fraction', () => {
    const rawTrackPayload = {
        tracks: [
            {
                track: 'production',
                releases: [
                    {
                        name: '1.4.2 (Production Staged Rollout)',
                        versionCodes: ['42'],
                        status: 'inProgress',
                        userFraction: 0.25, // 25% staged rollout
                        releaseNotes: [
                            { language: 'en-US', text: 'Bug fixes and performance improvements.' },
                            { language: 'id-ID', text: 'Perbaikan bug dan peningkatan stabilitas.' }
                        ]
                    },
                    {
                        name: '1.4.1 (Completed)',
                        versionCodes: ['41'],
                        status: 'completed',
                        userFraction: 1.0
                    }
                ]
            },
            {
                track: 'beta',
                releases: [
                    {
                        name: '1.5.0-beta1',
                        versionCodes: ['45'],
                        status: 'inProgress',
                        userFraction: 1.0,
                        releaseNotes: [
                            { language: 'en-US', text: 'Beta test for new mini-games!' }
                        ]
                    }
                ]
            }
        ]
    };

    const parsed = parseTrackReleases(rawTrackPayload);

    assert.equal(parsed.production !== undefined, true);
    assert.equal(parsed.production.track, 'production');
    assert.equal(parsed.production.currentRelease.versionCode, '42');
    assert.equal(parsed.production.currentRelease.status, 'inProgress');
    assert.equal(parsed.production.currentRelease.userFraction, 0.25);
    assert.equal(parsed.production.currentRelease.rolloutPercentage, 25);
    assert.equal(parsed.production.currentRelease.notes['id-ID'], 'Perbaikan bug dan peningkatan stabilitas.');
    assert.equal(parsed.production.currentRelease.notes['en-US'], 'Bug fixes and performance improvements.');

    assert.equal(parsed.beta !== undefined, true);
    assert.equal(parsed.beta.currentRelease.versionCode, '45');
    assert.equal(parsed.beta.currentRelease.status, 'inProgress');
    assert.equal(parsed.beta.currentRelease.rolloutPercentage, 100);
});
