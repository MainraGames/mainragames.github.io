import test from 'node:test';
import assert from 'node:assert/strict';

// Test suite for Contact Form and Inbox Architecture
test('Contact Form submission payload validation', () => {
    // A valid contact message must have name, email, and message
    function validateMessage(payload) {
        if (!payload.name || !payload.name.trim()) return { valid: false, error: 'Name is required' };
        if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) return { valid: false, error: 'Valid email is required' };
        if (!payload.message || !payload.message.trim()) return { valid: false, error: 'Message is required' };
        return { valid: true };
    }

    assert.equal(validateMessage({ name: '', email: 'test@example.com', message: 'Hello' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'invalid-email', message: 'Hello' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: '' }).valid, false);
    assert.equal(validateMessage({ name: 'Faris', email: 'faris@example.com', message: 'Halo Mainra!' }).valid, true);
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
