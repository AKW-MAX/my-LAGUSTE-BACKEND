const mongoose = require('mongoose');
const BusinessReport = require('../models/businessReports');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const doc = await BusinessReport.findOne({
    reportDate: {
      $gte: new Date('2026-08-20T00:00:00.000Z'),
      $lt: new Date('2026-08-21T00:00:00.000Z'),
    },
  }).sort({ reportDate: -1 }).lean();

  console.log(JSON.stringify(doc, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
