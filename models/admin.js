const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: true,
    },

    last_name: {
      type: String,
      required: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["superadmin", "admin"],
      default: "admin",
    },

    permissions: {
      type: [
        {
          type: String,
          enum: [
            "manage_orders",
            "manage_products",
            "add_product",
            "add_admin",
            "post_invoices",
            "audit_logs",
            "admin_activity",
            "edit_admin_permissions",
            "sale_receipts",
            "generate_daily_report",
            "view_region_analytics",
          ],
        },
      ],
      default: [],
    },

    approved: {
      type: Boolean,
      default: false,
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    passwordResetTokenHash: {
      type: String,
      default: "",
    },

    passwordResetTokenExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("admin", adminSchema);