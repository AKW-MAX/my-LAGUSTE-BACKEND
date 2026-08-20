const mongoose = require('mongoose');
const AnalyticsEvent = require('../models/analyticsEvents');
const { createDayRange } = require('../utils/businessReport');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const now = new Date('2026-08-20T00:00:00.000Z');
  const tzOffset = new Date().getTimezoneOffset();
  const { start, end } = createDayRange(now, tzOffset);
  console.log(JSON.stringify({ tzOffset, start: start.toISOString(), end: end.toISOString() }, null, 2));
  const count = await AnalyticsEvent.countDocuments({ createdAt: { $gte: start, $lt: end } });
  console.log('count', count);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
