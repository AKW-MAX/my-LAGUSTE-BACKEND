const mongoose = require('mongoose');
const BusinessReport = require('../models/businessReports');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const doc = await BusinessReport.findOne({
    reportDate: { $in: ['2026-08-20T00:00:00.000Z', '2026-08-20', new Date('2026-08-20')] },
  }).lean();

  console.log(JSON.stringify(doc?.traffic, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
