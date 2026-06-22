const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    customer: {
      name: String,
      phone: String,
      address: String,
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
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", orderSchema);