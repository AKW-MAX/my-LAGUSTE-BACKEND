const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    customer: {
      name: String,
      email: String,
      phone: String,
      address: String,
    },

    user: {
      id: String,
      name: String,
      email: String,
    },

    orderItems: [
      {
        _id: String,
        name: String,
        price: Number,
        cartQuantity: Number,
        img: String,
      },
    ],

    totalAmount: Number,

    status: {
      type: String,
      default: "Pending",
    },

    approvedBy: {
      id: String,
      username: String,
      email: String,
      at: Date,
    },

    invoice: {
      invoiceNumber: String,
      postedAt: Date,
      postedBy: {
        id: String,
        username: String,
        email: String,
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
      totalQuantity: Number,
      totalAmount: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);