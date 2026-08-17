const bcrypt = require('bcrypt');

const isBcryptHash = (value = '') => {
  if (typeof value !== 'string') return false;
  return /^\$2[aby]\$/.test(value);
};

const verifyCustomerPassword = async (providedPassword, storedPassword) => {
  if (!providedPassword || !storedPassword) {
    return { match: false, shouldHash: false };
  }

  if (isBcryptHash(storedPassword)) {
    const match = await bcrypt.compare(providedPassword, storedPassword);
    return { match, shouldHash: false };
  }

  const match = providedPassword === storedPassword;
  return { match, shouldHash: match };
};

module.exports = {
  verifyCustomerPassword,
};
