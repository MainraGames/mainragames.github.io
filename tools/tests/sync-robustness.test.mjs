import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Shared helpers for the tools/ scripts. Before these existed, a failed HTTP
// request looked exactly like "the API returned no data", and a per-package
// error was logged and then swallowed, leaving CI green.

const require = createRequire(import.meta.url);
const { assertOkResponse, createSyncTally } = require('../http-utils.js');

const fakeResponse = (status, body = '') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

test('assertOkResponse passes a 2xx response through', async () => {
  const res = fakeResponse(200, '[]');
  assert.equal(await assertOkResponse(res, 'games'), res);
  await assert.doesNotReject(() => assertOkResponse(fakeResponse(204), 'games'));
});

test('assertOkResponse throws on a failed request instead of returning undefined', async () => {
  await assert.rejects(
    () => assertOkResponse(fakeResponse(401, '{"message":"Invalid API key"}'), 'games'),
    (err) => {
      assert.match(err.message, /games/);
      assert.match(err.message, /401/);
      assert.match(err.message, /Invalid API key/);
      return true;
    },
  );

  await assert.rejects(() => assertOkResponse(fakeResponse(500, 'boom'), 'site_settings'), /site_settings/);
});

test('createSyncTally reports a failing exit code when any package errored', () => {
  const tally = createSyncTally('sync-tracks', () => {});

  tally.attempt();
  tally.attempt();
  tally.failure();

  const summary = tally.finish();

  assert.equal(summary.attempted, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.exitCode, 1);
});

test('createSyncTally stays green when every package synced', () => {
  const tally = createSyncTally('sync-vitals', () => {});

  tally.attempt();
  tally.attempt();
  tally.attempt();

  const summary = tally.finish();

  assert.equal(summary.attempted, 3);
  assert.equal(summary.failed, 0);
  assert.equal(summary.exitCode, 0);
});
