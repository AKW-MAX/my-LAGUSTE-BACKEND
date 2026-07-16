const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  passwordResetTokenHash: {
    type: String,
    default: "",
  },
  passwordResetTokenExpires: {
    type: Date,
    default: null,
  },
  profileImage: {
    type: String,
    default: ""
  }
});

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;