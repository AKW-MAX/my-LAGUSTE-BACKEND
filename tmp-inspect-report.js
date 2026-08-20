const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const AnalyticsEvent = require('./models/analyticsEvents');
  const BusinessReport = require('./models/businessReports');
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

  const events = await AnalyticsEvent.find({ createdAt: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).lean();
  console.log('events count', events.length);
  const relevant = events.filter((event) => {
    const type = String(event?.eventType || '').toLowerCase();
    return type === 'search' || type === 'click_item' || Boolean(event?.metadata?.query || event?.metadata?.productName || event?.metadata?.productId || event?.query || event?.productName || event?.productId);
  });
  console.log('relevant events', relevant.length);
  console.log(JSON.stringify(relevant.slice(0, 20), null, 2));

  const report = await BusinessReport.findOne({ reportDate: { $gte: start, $lt: end } }).sort({ createdAt: -1 }).lean();
  console.log('report', JSON.stringify(report && { reportDate: report.reportDate, engagement: report.engagement }, null, 2));

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
