const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const { buildBusinessReportSnapshot, createDayRange } = require('./utils/businessReport');
  const BusinessReport = require('./models/businessReports');
  const Order = require('./models/orders');
  const Products = require('./models/Products');
  const AnalyticsEvent = require('./models/analyticsEvents');

  const now = new Date();
  const timeZoneOffsetMinutes = now.getTimezoneOffset();
  const reportDateKey = now.toISOString().slice(0, 10);
  const { start, end } = createDayRange(now, timeZoneOffsetMinutes);

  const [orders, products, analyticsEvents] = await Promise.all([
    Order.find({}).select('createdAt totalAmount status orderItems customer user').lean(),
    Products.find({}).select('name category stock').lean(),
    AnalyticsEvent.find({ createdAt: { $gte: start, $lt: end } }).select('createdAt eventType page referrer sessionId ip userAgent metadata').lean(),
  ]);

  const snapshot = buildBusinessReportSnapshot({
    orders,
    products,
    analyticsEvents,
    now,
    reportDateKey,
    timeZoneOffsetMinutes,
  });

  const saved = await BusinessReport.findOneAndUpdate(
    { reportDate: reportDateKey },
    { $set: { ...snapshot, generatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(JSON.stringify(saved.engagement, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
