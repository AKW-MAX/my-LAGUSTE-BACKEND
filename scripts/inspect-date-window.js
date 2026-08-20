const mongoose = require('mongoose');
const { createDayRange } = require('../utils/businessReport');
const AnalyticsEvent = require('../models/analyticsEvents');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const now = new Date('2026-08-20T00:00:00.000Z');
  const tzOffset = new Date().getTimezoneOffset();
  const { start, end } = createDayRange(now, tzOffset);
  console.log(JSON.stringify({ tzOffset, start: start.toISOString(), end: end.toISOString() }, null, 2));

  const docs = await AnalyticsEvent.find({
    createdAt: { $gte: start, $lt: end },
  }).sort({ createdAt: -1 }).limit(20).lean();

  console.log('matching', docs.length);
  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
