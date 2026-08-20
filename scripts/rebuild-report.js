const mongoose = require('mongoose');
const BusinessReport = require('../models/businessReports');
const Order = require('../models/orders');
const Products = require('../models/Products');
const AnalyticsEvent = require('../models/analyticsEvents');
const { buildBusinessReportSnapshot, createDayRange, createPreviousDayRange } = require('../utils/businessReport');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const reportDateKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const now = new Date(`${reportDateKey}T00:00:00.000Z`);
  const tzOffset = new Date().getTimezoneOffset();
  const { start, end } = createDayRange(now, tzOffset);
  const { start: previousStart, end: previousEnd } = createPreviousDayRange(now, tzOffset);

  const [allOrders, dailyOrders, previousDayOrders, products, analyticsEvents] = await Promise.all([
    Order.find({}).select('createdAt totalAmount status orderItems customer user').lean(),
    Order.find({ createdAt: { $gte: start, $lt: end } }).select('createdAt totalAmount status orderItems customer user').lean(),
    Order.find({ createdAt: { $gte: previousStart, $lt: previousEnd } }).select('createdAt totalAmount status orderItems customer user').lean(),
    Products.find({}).select('name category stock').lean(),
    AnalyticsEvent.find({ createdAt: { $gte: start, $lt: end } }).select('createdAt eventType page referrer sessionId ip userAgent metadata').lean(),
  ]);

  const snapshot = buildBusinessReportSnapshot({
    orders: allOrders,
    products,
    analyticsEvents,
    dailyOrders,
    previousDayOrders,
    now,
    reportDateKey,
    timeZoneOffsetMinutes: tzOffset,
  });

  const reportDoc = await BusinessReport.findOneAndUpdate(
    { reportDate: snapshot.reportDate },
    { $set: { ...snapshot, generatedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(JSON.stringify({ reportDate: reportDoc.reportDate, traffic: reportDoc.traffic }, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
