const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { verifyCustomerPassword, normalizeCustomerEmail } = require('../utils/customerAuth');
const { buildBusinessReportSnapshot, shouldReuseExistingReport, createDayRange } = require('../utils/businessReport');
const { resolveEmailFromAddress } = require('../utils/smtpConfig');
const BusinessReport = require('../models/businessReports');

test('accepts legacy plain-text customer passwords and marks them for migration', async () => {
  const password = 'LegacyPass123!';
  const result = await verifyCustomerPassword(password, password);

  assert.equal(result.match, true);
  assert.equal(result.shouldHash, true);
});

test('accepts bcrypt-hashed customer passwords without migrating them', async () => {
  const password = 'SecurePass123!';
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await verifyCustomerPassword(password, hashedPassword);

  assert.equal(result.match, true);
  assert.equal(result.shouldHash, false);
});

test('accepts passwords that differ only by surrounding whitespace', async () => {
  const password = 'TrimMe123!';
  const result = await verifyCustomerPassword(`  ${password}  `, password);

  assert.equal(result.match, true);
  assert.equal(result.shouldHash, true);
});

test('normalizes customer emails by trimming whitespace and lowercasing them', () => {
  assert.equal(normalizeCustomerEmail('  John@Example.COM '), 'john@example.com');
});

test('uses the authenticated Gmail address as the sender when Gmail SMTP is configured', () => {
  const fromAddress = resolveEmailFromAddress({
    host: 'smtp.gmail.com',
    user: 'sender@gmail.com',
    from: 'no-reply@example.com',
  });

  assert.equal(fromAddress, 'sender@gmail.com');
});

test('persists engagement, category, and customer sections in saved reports', () => {
  const doc = new BusinessReport({
    reportDate: new Date('2024-08-09T00:00:00.000Z'),
    engagement: { mostClickedItems: [{ name: 'Tomatoes', count: 2 }] },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  });

  const plainDoc = doc.toObject();

  assert.deepEqual(plainDoc.engagement.mostClickedItems[0].name, 'Tomatoes');
  assert.deepEqual(plainDoc.categories.bestSelling[0].category, 'Vegetables');
  assert.equal(plainDoc.customers.repeatCustomers, 1);
});

test('counts anonymous page views, product views, and cart activity in the daily report', () => {
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [{ _id: 'product-1', name: 'Tomatoes', category: 'Vegetables', stock: 4 }],
    analyticsEvents: [
      { eventType: 'page_view', page: '/', createdAt: new Date(), metadata: { sessionId: 'guest-1' } },
      { eventType: 'product_view', page: '/product/product-1', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'add_to_cart', page: '/product/product-1', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1', cartItems: [{ name: 'Tomatoes' }] } },
    ],
    now: new Date(),
  });

  assert.equal(report.traffic.visits, 1);
  assert.equal(report.demand.cartAdditions[0]?.name, 'Tomatoes');
  assert.equal(report.demand.viewedButNotPurchased[0]?.name, 'Tomatoes');
});

test('uses a local calendar date for the report date', () => {
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [],
    analyticsEvents: [],
    now: new Date(2024, 7, 9, 14, 30, 0),
  });

  assert.equal(report.reportDate, '2024-08-09');
});

test('surfaces demand signals with views, cart additions, and orders', () => {
  const report = buildBusinessReportSnapshot({
    orders: [{
      createdAt: new Date(),
      totalAmount: 100,
      status: 'approved',
      orderItems: [{ name: 'Tomatoes', quantity: 2, price: 50 }],
    }],
    products: [{ _id: 'product-1', name: 'Tomatoes', category: 'Vegetables', stock: 4 }],
    analyticsEvents: [
      { eventType: 'product_view', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'product_view', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'add_to_cart', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'product_view', createdAt: new Date(), metadata: { productName: 'Broiler Booster', productId: 'product-2' } },
    ],
    now: new Date(),
  });

  const tomatoes = report.demand.mostDemandedProducts.find((item) => item.name === 'Tomatoes');
  const attentionWithoutSales = report.demand.attentionWithoutSales.find((item) => item.name === 'Broiler Booster');

  assert.ok(tomatoes);
  assert.equal(tomatoes.views, 2);
  assert.equal(tomatoes.cartAdditions, 1);
  assert.equal(tomatoes.orders, 1);
  assert.ok(attentionWithoutSales);
  assert.equal(attentionWithoutSales.views, 1);
});

test('summarizes the most searched terms and most clicked items', () => {
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [],
    analyticsEvents: [
      { eventType: 'search', createdAt: new Date(), metadata: { query: 'fertilizer' } },
      { eventType: 'search', createdAt: new Date(), metadata: { query: 'fertilizer' } },
      { eventType: 'search', createdAt: new Date(), metadata: { query: 'seeds' } },
      { eventType: 'click_item', createdAt: new Date(), metadata: { productName: 'Tomatoes' } },
      { eventType: 'click_item', createdAt: new Date(), metadata: { productName: 'Tomatoes' } },
      { eventType: 'click_item', createdAt: new Date(), metadata: { productName: 'Broiler Booster' } },
    ],
    now: new Date(),
  });

  assert.deepEqual(report.engagement.mostSearchedTerms.map((item) => item.term), ['fertilizer', 'seeds']);
  assert.deepEqual(report.engagement.mostClickedItems.map((item) => item.name), ['Tomatoes', 'Broiler Booster']);
});

test('uses viewed and clicked products as fallback sections when there are no searches or orders', () => {
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [{ _id: 'product-1', name: 'Tomatoes', category: 'Vegetables', stock: 8 }],
    analyticsEvents: [
      { eventType: 'product_view', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'product_view', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
      { eventType: 'click_item', createdAt: new Date(), metadata: { productName: 'Tomatoes', productId: 'product-1' } },
    ],
    now: new Date(),
  });

  assert.deepEqual(report.engagement.mostSearchedTerms.map((item) => item.term), ['Tomatoes']);
  assert.deepEqual(report.engagement.mostClickedItems.map((item) => item.name), ['Tomatoes']);
  assert.deepEqual(report.categories.bestSelling.map((item) => item.category), ['Viewed products']);
});

test('groups clicks by country and region and computes session duration', () => {
  const baseTime = new Date('2024-08-09T12:00:00.000Z');
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [],
    analyticsEvents: [
      { eventType: 'click_item', createdAt: new Date(baseTime.getTime()), metadata: { productName: 'Tomatoes', country: 'Kenya', region: 'Rift Valley' }, sessionId: 'session-1' },
      { eventType: 'click_item', createdAt: new Date(baseTime.getTime() + 60_000), metadata: { productName: 'Tomatoes', country: 'Kenya', region: 'Rift Valley' }, sessionId: 'session-1' },
      { eventType: 'page_view', createdAt: new Date(baseTime.getTime()), metadata: { country: 'Kenya', region: 'Nairobi' }, sessionId: 'session-2' },
      { eventType: 'page_view', createdAt: new Date(baseTime.getTime() + 180_000), metadata: { country: 'Kenya', region: 'Nairobi' }, sessionId: 'session-2' },
    ],
    now: baseTime,
  });

  assert.equal(report.engagement.locationBreakdown[0].country, 'Kenya');
  assert.equal(report.engagement.locationBreakdown[0].region, 'Rift Valley');
  assert.equal(report.engagement.locationBreakdown[0].count, 2);
  assert.equal(report.engagement.sessionDuration.averageSeconds, 120);
  assert.equal(report.engagement.sessionDuration.longestSeconds, 180);
});

test('groups clicked items by country and region', () => {
  const report = buildBusinessReportSnapshot({
    orders: [],
    products: [],
    analyticsEvents: [
      { eventType: 'click_item', createdAt: new Date(), country: 'Kenya', region: 'Rift Valley', metadata: { productName: 'Tomatoes' } },
      { eventType: 'click_item', createdAt: new Date(), country: 'Kenya', region: 'Rift Valley', metadata: { productName: 'Tomatoes' } },
      { eventType: 'click_item', createdAt: new Date(), country: 'Kenya', region: 'Nairobi', metadata: { productName: 'Broiler Booster' } },
    ],
    now: new Date(),
  });

  assert.deepEqual(report.engagement.clickLocations.map((item) => `${item.country}/${item.region}`), ['Kenya/Rift Valley', 'Kenya/Nairobi']);
  assert.equal(report.engagement.clickLocations[0].count, 2);
});

test('rebuilds a stored report when the newer engagement and category sections are missing', () => {
  const existingReport = { reportDate: '2024-08-09' };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, false);
});

test('skips reuse when a fresh rebuild is explicitly requested', () => {
  const existingReport = {
    reportDate: '2024-08-09',
    engagement: {
      mostSearchedTerms: [{ term: 'fertilizer', count: 2 }],
      mostClickedItems: [{ name: 'Tomatoes', count: 2 }],
      clickLocations: [{ country: 'Kenya', region: 'Nairobi', count: 1 }],
      clicksPerCountry: [{ country: 'Kenya', count: 1 }],
      topRegions: [{ label: 'Kenya / Nairobi', count: 1 }],
      sessionDuration: { averageSeconds: 30, longestSeconds: 60 },
    },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0), null, { forceRefresh: true });

  assert.equal(result, false);
});

test('reuses an existing same-day report when it already contains engagement and category sections', () => {
  const existingReport = {
    reportDate: new Date(2024, 7, 9, 0, 0, 0),
    engagement: {
      mostSearchedTerms: [{ term: 'fertilizer', count: 2 }],
      mostClickedItems: [{ name: 'Tomatoes', count: 2 }],
      clickLocations: [{ country: 'Kenya', region: 'Nairobi', count: 1 }],
      clicksPerCountry: [{ country: 'Kenya', count: 1 }],
      topRegions: [{ label: 'Kenya / Nairobi', count: 1 }],
      sessionDuration: { averageSeconds: 30, longestSeconds: 60 },
    },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, true);
});

test('rebuilds a same-day report when newer analytics events arrived after the report was generated', () => {
  const existingReport = {
    reportDate: '2024-08-09',
    generatedAt: new Date('2024-08-09T00:00:00.000Z'),
    engagement: {
      mostSearchedTerms: [{ term: 'fertilizer', count: 2 }],
      mostClickedItems: [{ name: 'Tomatoes', count: 2 }],
      clickLocations: [{ country: 'Kenya', region: 'Nairobi', count: 1 }],
      clicksPerCountry: [{ country: 'Kenya', count: 1 }],
      topRegions: [{ label: 'Kenya / Nairobi', count: 1 }],
      sessionDuration: { averageSeconds: 30, longestSeconds: 60 },
    },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0), new Date('2024-08-09T01:00:00.000Z'));

  assert.equal(result, false);
});

test('rebuilds a report when the new country-level engagement summary is missing', () => {
  const existingReport = {
    reportDate: '2024-08-09',
    engagement: {
      mostSearchedTerms: [{ term: 'fertilizer', count: 2 }],
      mostClickedItems: [{ name: 'Tomatoes', count: 2 }],
      clickLocations: [{ country: 'Kenya', region: 'Nairobi', count: 1 }],
      topRegions: [{ label: 'Kenya / Nairobi', count: 1 }],
      sessionDuration: { averageSeconds: 30, longestSeconds: 60 },
    },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, false);
});

test('rebuilds a report when the engagement arrays are empty even if the keys exist', () => {
  const existingReport = {
    reportDate: '2024-08-09',
    engagement: {
      mostSearchedTerms: [],
      mostClickedItems: [],
      clickLocations: [],
      topRegions: [],
      sessionDuration: { averageSeconds: 0, longestSeconds: 0 },
    },
    categories: { bestSelling: [] },
    customers: { repeatCustomers: 0 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, false);
});

test('reuses an existing same-day report instead of rebuilding it when the modern sections are present', () => {
  const existingReport = {
    reportDate: '2024-08-09',
    engagement: {
      mostSearchedTerms: [{ term: 'fertilizer', count: 2 }],
      mostClickedItems: [{ name: 'Tomatoes', count: 2 }],
      clickLocations: [{ country: 'Kenya', region: 'Nairobi', count: 1 }],
      clicksPerCountry: [{ country: 'Kenya', count: 1 }],
      topRegions: [{ label: 'Kenya / Nairobi', count: 1 }],
      sessionDuration: { averageSeconds: 30, longestSeconds: 60 },
    },
    categories: { bestSelling: [{ category: 'Vegetables', quantity: 5 }] },
    customers: { repeatCustomers: 1 },
  };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, true);
});

test('creates a day range using the supplied timezone offset', () => {
  const { start, end } = createDayRange(new Date('2024-08-09T00:00:00.000Z'), -180);

  assert.equal(start.toISOString(), '2024-08-08T21:00:00.000Z');
  assert.equal(end.toISOString(), '2024-08-09T21:00:00.000Z');
});
