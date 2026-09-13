// Assets/js/contact-validation.js
// Validation rules for the public contact form.
//
// Loaded as a classic script by the public pages (so `window.MainraContactValidation`
// is available to Assets/js/site.js) and required as CommonJS by
// tools/tests/contact-inbox.test.mjs — one implementation, exercised by the test
// and by the browser alike.
//
// The limits here mirror the CHECK constraints in
// supabase/migrations/0024_harden_contact_messages.sql so a user is told about a
// rejected message instead of getting a database error back.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MainraContactValidation = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    /**
     * @returns {{valid: boolean, honeypot?: boolean, error?: string, value?: object}}
     *   `honeypot: true` means the submission looked like a bot: the caller must
     *   show a fake success and never write anything.
     */
    function validateContactMessage(payload) {
        if (!payload) return { valid: false, error: 'Data pesan tidak lengkap.' };

        var name = String(payload.name || '').trim();
        var email = String(payload.email || '').trim();
        var subject = String(payload.subject || '').trim();
        var message = String(payload.message || '').trim();
        var honeypot = String(payload.website_hp || '').trim();

        // Anti-bot honeypot: a real user never sees this field, let alone fills it.
        if (honeypot) {
            return { valid: false, honeypot: true, error: 'Bot terdeteksi (honeypot terisi).' };
        }

        if (!name || name.length > 100) {
            return { valid: false, error: 'Mohon isi nama Anda (maksimal 100 karakter).' };
        }
        if (!email || email.length > 120 || !EMAIL_PATTERN.test(email)) {
            return { valid: false, error: 'Mohon isi alamat email yang valid (maksimal 120 karakter).' };
        }
        if (subject.length > 200) {
            return { valid: false, error: 'Subjek maksimal 200 karakter.' };
        }
        if (!message || message.length > 3000) {
            return { valid: false, error: 'Mohon isi pesan Anda (maksimal 3000 karakter).' };
        }

        return {
            valid: true,
            value: { name: name, email: email, subject: subject, message: message },
        };
    }

    return { validateContactMessage: validateContactMessage };
});
