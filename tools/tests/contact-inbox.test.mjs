import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Exercises the SAME validator the browser loads in Assets/js/site.js.
// Limits here must match the CHECK constraints added in
// supabase/migrations/0024_harden_contact_messages.sql.

const require = createRequire(import.meta.url);
const {
  validateContactMessage,
} = require('../../Assets/js/contact-validation.js');

test('contact form validation rejects incomplete submissions', () => {
  assert.equal(validateContactMessage(null).valid, false);
  assert.equal(validateContactMessage({ name: '', email: 'test@example.com', message: 'Hello' }).valid, false);
  assert.equal(validateContactMessage({ name: 'Faris', email: 'invalid-email', message: 'Hello' }).valid, false);
  assert.equal(validateContactMessage({ name: 'Faris', email: 'faris@example.com', message: '' }).valid, false);
  assert.equal(
    validateContactMessage({ name: 'Faris', email: 'faris@example.com', message: 'Halo Mainra!' }).valid,
    true,
  );
});

test('contact form validation returns the trimmed values that get inserted', () => {
  const result = validateContactMessage({
    name: '  Faris  ',
    email: ' faris@example.com ',
    subject: '  Kerja sama  ',
    message: '  Halo Mainra!  ',
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    name: 'Faris',
    email: 'faris@example.com',
    subject: 'Kerja sama',
    message: 'Halo Mainra!',
  });
});

test('contact form validation enforces the same limits as the database CHECK constraints', () => {
  const base = { name: 'Faris', email: 'faris@example.com', message: 'Halo!' };

  assert.equal(validateContactMessage({ ...base, name: 'A'.repeat(100) }).valid, true);
  assert.equal(validateContactMessage({ ...base, name: 'A'.repeat(101) }).valid, false);

  assert.equal(validateContactMessage({ ...base, message: 'A'.repeat(3000) }).valid, true);
  assert.equal(validateContactMessage({ ...base, message: 'A'.repeat(3001) }).valid, false);

  assert.equal(validateContactMessage({ ...base, subject: 'A'.repeat(200) }).valid, true);
  assert.equal(validateContactMessage({ ...base, subject: 'A'.repeat(201) }).valid, false);

  // '@example.com' is 12 chars, so 108 + 12 = 120 is the boundary the DB allows.
  assert.equal(validateContactMessage({ ...base, email: 'a'.repeat(108) + '@example.com' }).valid, true);
  assert.equal(validateContactMessage({ ...base, email: 'a'.repeat(109) + '@example.com' }).valid, false);
});

test('a honeypot submission is flagged instead of reported as a validation error', () => {
  const bot = validateContactMessage({
    name: 'Bot',
    email: 'spammer@domain.com',
    message: 'Buy cheap seo',
    website_hp: 'http://spam.ru',
  });

  assert.equal(bot.valid, false);
  assert.equal(bot.honeypot, true);

  const human = validateContactMessage({ ...{ name: 'Faris', email: 'faris@example.com', message: 'Halo Mainra!' }, website_hp: '' });
  assert.equal(human.valid, true);
  assert.ok(!human.honeypot);
});
