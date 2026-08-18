const bcrypt = require('bcrypt');

const normalizeCustomerEmail = (value = '') => {
  return String(value ?? '').trim().toLowerCase();
};

const escapeRegex = (value = '') => {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const buildCustomerEmailQuery = (value = '') => {
  const normalizedEmail = normalizeCustomerEmail(value);
  if (!normalizedEmail) {
    return null;
  }

  return {
    email: {
      $regex: `^${escapeRegex(normalizedEmail)}$`,
      $options: 'i',
    },
  };
};

const isBcryptHash = (value = '') => {
  if (typeof value !== 'string') return false;
  return /^\$2[aby]\$/.test(value);
};

const verifyCustomerPassword = async (providedPassword, storedPassword) => {
  const normalizedProvided = String(providedPassword ?? "").trim();
  const normalizedStored = String(storedPassword ?? "").trim();

  if (!normalizedProvided || !normalizedStored) {
    return { match: false, shouldHash: false };
  }

  if (isBcryptHash(normalizedStored)) {
    const match = await bcrypt.compare(normalizedProvided, normalizedStored);
    return { match, shouldHash: false };
  }

  const match = normalizedProvided === normalizedStored;
  return { match, shouldHash: match };
};

module.exports = {
  normalizeCustomerEmail,
  buildCustomerEmailQuery,
  verifyCustomerPassword,
};
