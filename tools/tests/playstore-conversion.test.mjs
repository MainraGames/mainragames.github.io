import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseConversionRates,
  assessFunnelPerformance,
  parseSearchKeywords
} = require('../conversion-utils.js');

test('parseConversionRates accurately extracts store listing visitors and installers per channel', () => {
  const mockMetricSet = {
    rows: [
      {
        startTime: '2026-09-01T00:00:00Z',
        aggregationPeriod: 'DAY',
        dimensions: [
          { dimension: 'countryCode', stringValue: 'ID' },
          { dimension: 'trafficSource', stringValue: 'SEARCH' }
        ],
        metrics: [
          { metric: 'storeListingVisitors', decimalValue: { value: '1250' } },
          { metric: 'storeListingAcquisitions', decimalValue: { value: '380' } }
        ]
      },
      {
        startTime: '2026-09-01T00:00:00Z',
        aggregationPeriod: 'DAY',
        dimensions: [
          { dimension: 'countryCode', stringValue: 'GLOBAL' },
          { dimension: 'trafficSource', stringValue: 'ALL' }
        ],
        metrics: [
          { metric: 'storeListingVisitors', decimalValue: { value: '5000' } },
          { metric: 'storeListingAcquisitions', decimalValue: { value: '1200' } }
        ]
      }
    ]
  };

  const parsed = parseConversionRates(mockMetricSet);
  assert.equal(parsed.totalVisitors, 5000);
  assert.equal(parsed.totalAcquisitions, 1200);
  assert.equal(parsed.conversionRatePercent, 24.0);
  assert.equal(parsed.breakdowns.length, 2);
  assert.equal(parsed.breakdowns[0].country, 'ID');
  assert.equal(parsed.breakdowns[0].visitors, 1250);
  assert.equal(parsed.breakdowns[0].acquisitions, 380);
  assert.equal(parsed.breakdowns[0].ratePercent, 30.4);
});

test('assessFunnelPerformance assigns healthy, fair, or low benchmark ratings', () => {
  assert.equal(assessFunnelPerformance(28.5).grade, 'excellent');
  assert.equal(assessFunnelPerformance(18.0).grade, 'good');
  assert.equal(assessFunnelPerformance(9.5).grade, 'low');
});

test('parseSearchKeywords sorts top keywords by search traffic and conversion', () => {
  const mockKeywords = [
    { keyword: 'pop it game', visitors: 800, acquisitions: 240 },
    { keyword: 'fidget 3d', visitors: 1200, acquisitions: 420 },
    { keyword: 'jelly merge', visitors: 400, acquisitions: 60 }
  ];

  const sorted = parseSearchKeywords(mockKeywords);
  assert.equal(sorted[0].keyword, 'fidget 3d');
  assert.equal(sorted[0].conversionRate, 35.0);
  assert.equal(sorted[1].keyword, 'pop it game');
  assert.equal(sorted[1].conversionRate, 30.0);
});
