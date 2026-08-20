const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessAdminRoute } = require('../utils/accessControl');

test('allows daily report access for admins granted the daily report permission', () => {
  const result = canAccessAdminRoute('/admin/daily-report', {
    role: 'admin',
    permissions: ['generate_daily_report'],
  });

  assert.equal(result, true);
});

test('allows region analytics access for admins granted the region analytics permission', () => {
  const result = canAccessAdminRoute('/admin/region-analytics', {
    role: 'admin',
    permissions: ['view_region_analytics'],
  });

  assert.equal(result, true);
});
