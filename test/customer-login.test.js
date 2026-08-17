const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { verifyCustomerPassword } = require('../utils/customerAuth');

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
