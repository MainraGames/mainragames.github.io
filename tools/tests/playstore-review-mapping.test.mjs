import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Exercises the production mapper. A copy of the mapping logic used to live in
// this file and had silently drifted (no device_name, no app_version_*, no
// thumbs_*_count, no device_metadata, no replySentAt from the API).

const require = createRequire(import.meta.url);
const { mapReview } = require('../sync-playstore-reviews.js');

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
        lastModified: { seconds: '1789218780' },
      },
      developerComment: {
        text: 'Sorry about that! We have noted this issue and a fix is coming in the next update. Feel free to reach out at mainragames@gmail.com.',
        lastModified: { seconds: '1789218800' },
      },
    },
  ],
};

test('mapReview keeps the whole review text and the developer reply', () => {
  const mapped = mapReview(rawApiReview, 'com.MainraGames.SquishyJellyMerge');

  assert.equal(mapped.review_id, 'gp:AOqpTOH_sample_review_id');
  assert.equal(mapped.game_id, 'com.MainraGames.SquishyJellyMerge');
  assert.equal(mapped.author_name, 'سجاد');
  assert.equal(mapped.content, 'I had fun 😂😂😂😂😂 Okay');
  assert.equal(mapped.star_rating, 5);
  assert.equal(mapped.lang, 'fa');
  assert.equal(mapped.source, 'playstore');
  assert.equal(mapped.reply_text.includes('mainragames@gmail.com'), true);
});

test('mapReview carries the device, version and thumbs fields the dashboard renders', () => {
  const mapped = mapReview(rawApiReview, 'com.MainraGames.SquishyJellyMerge');

  assert.equal(mapped.device_name, 'SM-T225');
  assert.deepEqual(mapped.device_metadata, { deviceModel: 'SM-T225' });
  assert.equal(mapped.thumbs_up_count, 0);
  assert.equal(mapped.thumbs_down_count, 0);
  assert.equal(mapped.app_version_code, null);
  assert.equal(mapped.app_version_name, null);
});

test('mapReview derives replySentAt from the API timestamp, not from the clock', () => {
  const mapped = mapReview(rawApiReview, 'com.MainraGames.SquishyJellyMerge');

  assert.equal(mapped.replySentAt, new Date(1789218800 * 1000).toISOString());
});

test('mapReview omits reply fields when the developer has not replied', () => {
  const withoutReply = {
    ...rawApiReview,
    comments: [{ userComment: rawApiReview.comments[0].userComment }],
  };

  const mapped = mapReview(withoutReply, 'com.MainraGames.SquishyJellyMerge');

  assert.equal('reply_text' in mapped, false);
  assert.equal('replySentAt' in mapped, false);
});
