const mongoose = require("mongoose");

const businessReportSchema = new mongoose.Schema(
  {
    reportDate: {
      type: Date,
      required: true,
      unique: true,
    },
    traffic: {
      type: Object,
      default: {},
    },
    sales: {
      type: Object,
      default: {},
    },
    demand: {
      type: Object,
      default: {},
    },
    inventory: {
      type: Object,
      default: {},
    },
    insights: {
      type: [String],
      default: [],
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BusinessReport", businessReportSchema);
