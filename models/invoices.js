const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    sourceOrderId: {
      type: String,
      default: "",
    },

    sourceType: {
      type: String,
      enum: ["manual", "order", "supplier"],
      default: "manual",
    },

    inventoryAction: {
      type: String,
      enum: ["out", "in"],
      default: "out",
    },

    invoiceDate: {
      type: Date,
      default: Date.now,
    },

    supplier: {
      name: {
        type: String,
        default: "",
      },
      contact: {
        type: String,
        default: "",
      },
    },

    customer: {
      name: {
        type: String,
        default: "",
      },
      email: {
        type: String,
        default: "",
      },
      phone: {
        type: String,
        default: "",
      },
      address: {
        type: String,
        default: "",
      },
    },

    items: [
      {
        productId: String,
        name: String,
        quantity: Number,
        unitPrice: Number,
        lineTotal: Number,
      },
    ],

    totalQuantity: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      default: 0,
    },

    postedBy: {
      id: String,
      username: String,
      email: String,
    },

    postedAt: {
      type: Date,
      default: Date.now,
    },

    receipt: {
      receiptNumber: {
        type: String,
        default: "",
      },
      issuedAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Invoice", invoiceSchema);