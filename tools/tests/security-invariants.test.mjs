import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Security invariants that must hold across Edge Functions and migrations.
// These are structural regression gates: they fail if a previously fixed
// hole is reintroduced (see AUDIT-mainragames-2026-09-14.md).

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const src = (rel) => readFileSync(path.join(repo, rel), 'utf8');
const exists = (rel) => existsSync(path.join(repo, rel));

const HARDENING_MIGRATION = 'supabase/migrations/0025_harden_review_queue_and_contact.sql';

test('process-review-queue authenticates the caller before building a service-role client', () => {
  const fn = src('supabase/functions/process-review-queue/index.ts');

  assert.match(fn, /x-worker-secret/, 'worker secret header must be accepted from the pg_net trigger');
  assert.match(fn, /return json\(401/, 'unauthenticated callers must be rejected with 401');

  const guardAt = fn.search(/const auth = await authorize\(|await authorize\(req/);
  const clientAt = fn.indexOf('createClient(supabaseUrl, serviceKey');
  assert.ok(guardAt !== -1, 'handler must call an authorize() guard');
  assert.ok(clientAt !== -1, 'handler still builds a service-role client');
  assert.ok(guardAt < clientAt, 'authorization must happen before the service-role client is used');
});

test('the Gemini key listing never spreads the raw key into the response', () => {
  const fn = src('supabase/functions/ai-social-assistant/index.ts');

  assert.doesNotMatch(
    fn,
    /\.\.\.k,\s*\n\s*keyMasked/,
    'spreading ...k leaks the unmasked key to the browser',
  );
  assert.match(fn, /function maskKeyForClient/, 'a single explicit-field helper must build the client payload');
  // `map(maskKeyForClient)` passes the reference, so count bare identifiers:
  // 1 declaration + one use in each key-returning action.
  const uses = fn.match(/maskKeyForClient/g) || [];
  assert.ok(uses.length >= 4, `maskKeyForClient must be used by every key-returning action (found ${uses.length})`);
});

test('verify-purchase fails closed when IAP_VERIFY_SECRET is not configured', () => {
  const fn = src('supabase/functions/verify-purchase/index.ts');

  assert.match(fn, /IAP_VERIFY_SECRET/);
  assert.match(fn, /if \(!configuredSecret\)/, 'missing secret must reject the request, not skip the check');
  assert.match(fn, /timingSafeEqual/, 'secret comparison must be constant-time');
});

test('verify-purchase does not silently drop a failed write and short-circuits replays', () => {
  const fn = src('supabase/functions/verify-purchase/index.ts');

  assert.match(fn, /const \{ error: (upsertErr|writeErr|insErr) \}/, 'the DB write result must be checked');
  assert.match(fn, /alreadyVerified/, 'an already-VALID purchase token must be answered without re-hitting Google');
});

test('migration 0025 revokes EXECUTE on the pgmq helpers from anon and pins search_path', () => {
  assert.ok(exists(HARDENING_MIGRATION), `${HARDENING_MIGRATION} must exist`);
  const sql = src(HARDENING_MIGRATION);

  for (const fnName of [
    'public.read_review_queue(integer, integer)',
    'public.archive_review_queue(bigint)',
    'public.delete_review_queue(bigint)',
    'public.trigger_process_review_queue()',
  ]) {
    assert.ok(
      sql.includes(`revoke execute on function ${fnName}`),
      `must revoke EXECUTE on ${fnName}`,
    );
    assert.ok(
      sql.includes(`grant execute on function ${fnName} to service_role`),
      `must re-grant EXECUTE on ${fnName} to service_role only`,
    );
  }

  assert.match(sql, /alter function public\.read_review_queue\(integer, integer\) set search_path = ''/);
  assert.match(sql, /alter function public\.enqueue_5star_review_for_reply\(\) set search_path = ''/);
});

test('the pg_net trigger authenticates itself to the worker', () => {
  const sql = src(HARDENING_MIGRATION);

  assert.match(sql, /x-worker-secret/, 'trigger must send the shared secret header');
  assert.match(sql, /review_queue_secret/, 'secret must live in site_settings so DB and function agree');
  assert.match(sql, /site_settings public read/, 'the public read policy must be re-issued to hide the secret');
});

test('the public contact form is rate-limited and cannot backdate itself', () => {
  const sql = src(HARDENING_MIGRATION);

  assert.match(sql, /before insert on public\.contact_messages/, 'a BEFORE INSERT guard is required');
  assert.match(sql, /new\.created_at := now\(\)/, 'created_at must be assigned server-side');
  assert.match(sql, /interval '1 hour'/, 'a per-email hourly cap is required');
});
