const mongoose = require('mongoose');
const AnalyticsEvent = require('../models/analyticsEvents');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const docs = await AnalyticsEvent.find({
    createdAt: {
      $gte: new Date('2026-08-20T00:00:00.000Z'),
      $lt: new Date('2026-08-21T00:00:00.000Z'),
    },
  }).sort({ createdAt: -1 }).limit(20).lean();

  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
