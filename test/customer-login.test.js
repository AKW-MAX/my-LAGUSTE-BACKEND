const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { verifyCustomerPassword, normalizeCustomerEmail } = require('../utils/customerAuth');
const { buildBusinessReportSnapshot, shouldReuseExistingReport, createDayRange } = require('../utils/businessReport');

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

test('reuses an existing same-day report when stored as a Date object', () => {
  const existingReport = { reportDate: new Date(2024, 7, 9, 0, 0, 0) };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, true);
});

test('reuses an existing same-day report instead of rebuilding it', () => {
  const existingReport = { reportDate: '2024-08-09' };
  const result = shouldReuseExistingReport(existingReport, new Date(2024, 7, 9, 14, 30, 0));

  assert.equal(result, true);
});

test('creates a day range using the supplied timezone offset', () => {
  const { start, end } = createDayRange(new Date('2024-08-09T00:00:00.000Z'), -180);

  assert.equal(start.toISOString(), '2024-08-08T03:00:00.000Z');
  assert.equal(end.toISOString(), '2024-08-09T03:00:00.000Z');
});
