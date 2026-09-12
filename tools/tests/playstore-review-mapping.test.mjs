import test from 'node:test';
import assert from 'node:assert/strict';

// Test mapping logic for Google Play Developer API reviews
function mapApiReview(r, appId) {
    const comment = (r.comments && r.comments[0]) || {};
    const c = comment.userComment || {};
    const reply = comment.developerComment || {};
    const lm = c.lastModified && (c.lastModified.seconds || c.lastModified.serverValue);

    // FIX: c.text is a string ("I had fun..."), NOT an array. c.text[0] was bugged to only grab the first character 'I'
    let content = '';
    if (typeof c.text === 'string') {
        content = c.text;
    } else if (Array.isArray(c.text)) {
        content = c.text[0] || '';
    }

    let replyText = null;
    if (typeof reply.text === 'string') {
        replyText = reply.text;
    } else if (Array.isArray(reply.text)) {
        replyText = reply.text[0] || '';
    }

    const row = {
        review_id: r.reviewId,
        game_id: appId,
        author_name: (r.authorName && (r.authorName.displayName || r.authorName)) || c.authorName || 'Anonymous',
        content: content,
        star_rating: c.starRating || null,
        versionCode: c.appVersionName || null,
        device: c.deviceMetadata && (c.deviceMetadata.deviceModel || (Array.isArray(c.deviceMetadata) && c.deviceMetadata[0]?.deviceModel)) || null,
        review_timestamp: lm ? Number(lm) * 1000 : null,
        lang: c.reviewLanguage || null,
        source: 'playstore'
    };

    if (replyText) {
        row.reply_text = replyText;
        row.replySentAt = new Date().toISOString();
    }
    return row;
}

test('mapApiReview correctly handles full review text and edited ratings', () => {
    const rawApiReview = {
        reviewId: 'gp:AOqpTOH_sample_review_id',
        authorName: { displayName: 'سجاد' },
        comments: [
            {
                userComment: {
                    text: 'I had fun 😂😂😂😂😂 Okay',
                    starRating: 5,
                    reviewLanguage: 'fa',
                    deviceMetadata: { deviceModel: 'SM-T225' },
                    lastModified: { seconds: '1789218780' }
                },
                developerComment: {
                    text: 'Sorry about that! We have noted this issue and a fix is coming in the next update. Feel free to reach out at mainragames@gmail.com.',
                    lastModified: { seconds: '1789218800' }
                }
            }
        ]
    };

    const mapped = mapApiReview(rawApiReview, 'com.MainraGames.SquishyJellyMerge');

    assert.equal(mapped.author_name, 'سجاد');
    assert.equal(mapped.content, 'I had fun 😂😂😂😂😂 Okay');
    assert.equal(mapped.star_rating, 5);
    assert.equal(mapped.lang, 'fa');
    assert.equal(mapped.reply_text.includes('mainragames@gmail.com'), true);
});
