import test from 'node:test';
import assert from 'node:assert/strict';

// Test suite for Contact Form, Anti-Spam (Honeypot), and Inbox Architecture
test('Contact Form submission payload validation', () => {
    // A valid contact message must have name, email, message, reasonable lengths, and honeypot empty
    function validateMessage(payload) {
        if (!payload) return { valid: false, error: 'Empty payload' };
        
        // Anti-bot Honeypot check: If filled, it's an automated spam bot
        if (payload.website_hp && payload.website_hp.trim().length > 0) {
            return { valid: false, error: 'Bot detected (honeypot triggered)' };
        }

        const name = (payload.name || '').trim();
        const email = (payload.email || '').trim();
        const subject = (payload.subject || '').trim();
        const message = (payload.message || '').trim();

        if (!name || name.length > 100) return { valid: false, error: 'Name is required (max 100 chars)' };
        if (!email || email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false, error: 'Valid email is required (max 120 chars)' };
        if (subject.length > 200) return { valid: false, error: 'Subject cannot exceed 200 chars' };
        if (!message || message.length > 3000) return { valid: false, error: 'Message is required (max 3000 chars)' };

        return { valid: true };
    }

    assert.equal(validateMessage({ name: '', email: 'test@example.com', message: 'Hello' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'invalid-email', message: 'Hello' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: '' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: 'Halo Mainra!' }).valid, true);
    
    // Honeypot anti-spam tests
    assert.equal(validateMessage({ name: 'Bot', email: 'spammer@domain.com', message: 'Buy cheap seo', website_hp: 'http://spam.ru' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: 'Halo Mainra!', website_hp: '' }).valid, true);

    // Character length limits tests
    const longName = 'A'.repeat(101);
    assert.equal(validateMessage({ name: longName, email: 'faris@example.com', message: 'Halo!' }).valid, false);

    const longMessage = 'A'.repeat(3001);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: longMessage }).valid, false);
});

test('Inbox message status filters', () => {
    const sampleMessages = [
        { id: '1', name: 'Alice', status: 'unread', created_at: '2026-09-12T10:00:00Z' },
        { id: '2', name: 'Bob', status: 'read', created_at: '2026-09-12T09:00:00Z' },
        { id: '3', name: 'Charlie', status: 'replied', created_at: '2026-09-12T08:00:00Z' },
    ];

    function filterInbox(messages, filter) {
        if (!filter || filter === 'all') return messages;
        return messages.filter(m => m.status === filter);
    }

    assert.equal(filterInbox(sampleMessages, 'all').length, 3);
    assert.equal(filterInbox(sampleMessages, 'unread').length, 1);
    assert.equal(filterInbox(sampleMessages, 'read').length, 1);
    assert.equal(filterInbox(sampleMessages, 'replied').length, 1);
});
