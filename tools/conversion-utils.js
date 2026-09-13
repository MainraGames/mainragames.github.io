// tools/conversion-utils.js
// Utility helpers for Google Play Reporting API conversionRateMetricSet & searchKeywords

function parseConversionRates(metricSet) {
  if (!metricSet || !Array.isArray(metricSet.rows)) {
    return {
      totalVisitors: 0,
      totalAcquisitions: 0,
      conversionRatePercent: 0,
      breakdowns: []
    };
  }

  const breakdowns = [];
  let totalVisitors = 0;
  let totalAcquisitions = 0;

  for (const row of metricSet.rows) {
    const dims = row.dimensions || [];
    const metrics = row.metrics || [];

    const countryDim = dims.find(d => d.dimension === 'countryCode');
    const sourceDim = dims.find(d => d.dimension === 'trafficSource');

    const country = countryDim ? countryDim.stringValue : 'UNKNOWN';
    const source = sourceDim ? sourceDim.stringValue : 'ALL';

    const visitorsMetric = metrics.find(m => m.metric === 'storeListingVisitors');
    const acqMetric = metrics.find(m => m.metric === 'storeListingAcquisitions');

    const visitors = visitorsMetric?.decimalValue?.value ? parseInt(visitorsMetric.decimalValue.value, 10) : 0;
    const acquisitions = acqMetric?.decimalValue?.value ? parseInt(acqMetric.decimalValue.value, 10) : 0;

    const rate = visitors > 0 ? parseFloat(((acquisitions / visitors) * 100).toFixed(1)) : 0;

    if (country === 'GLOBAL' && source === 'ALL') {
      totalVisitors = visitors;
      totalAcquisitions = acquisitions;
    } else if (country !== 'GLOBAL' && totalVisitors === 0) {
      totalVisitors += visitors;
      totalAcquisitions += acquisitions;
    }

    breakdowns.push({
      country,
      source,
      visitors,
      acquisitions,
      ratePercent: rate
    });
  }

  const globalRate = totalVisitors > 0 ? parseFloat(((totalAcquisitions / totalVisitors) * 100).toFixed(1)) : 0;

  return {
    totalVisitors,
    totalAcquisitions,
    conversionRatePercent: globalRate,
    breakdowns
  };
}

function assessFunnelPerformance(conversionRate) {
  const rate = Number(conversionRate) || 0;
  if (rate >= 25.0) {
    return { grade: 'excellent', label: 'Tinggi (Di Atas Rata-rata Industri)', color: '#22c55e' };
  }
  if (rate >= 15.0) {
    return { grade: 'good', label: 'Bagus (Sehat / Standar Industri)', color: '#38bdf8' };
  }
  return { grade: 'low', label: 'Rendah (Perlu Optimasi Ikon & ASO)', color: '#f59e0b' };
}

function parseSearchKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];

  return keywords.map(k => {
    const visitors = Number(k.visitors) || 0;
    const acquisitions = Number(k.acquisitions) || 0;
    const rate = visitors > 0 ? parseFloat(((acquisitions / visitors) * 100).toFixed(1)) : 0;

    return {
      keyword: k.keyword || 'Unknown',
      visitors,
      acquisitions,
      conversionRate: rate
    };
  }).sort((a, b) => b.visitors - a.visitors);
}

module.exports = {
  parseConversionRates,
  assessFunnelPerformance,
  parseSearchKeywords
};
