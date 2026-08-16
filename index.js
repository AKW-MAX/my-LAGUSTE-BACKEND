const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const crypto = require('crypto');
const nodemailer = require("nodemailer");
require('dotenv').config();
const jwt = require("jsonwebtoken");

const Products = require('./models/Products');
const Customer = require('./models/customers');
const Order = require('./models/orders'); // FIXED NAME
const Invoice = require('./models/invoices');
const adminAuth = require("./middleware/adminAuths");
const AdminModel = require("./models/admin");
const AdminAuditLog = require("./models/adminAuditLog");

const app = express();
app.use(express.json());
app.use(cors());

const mongoUri = process.env.MONGO_URI;
const ports = process.env.PORT || 5000;
const ALL_ADMIN_PERMISSIONS = [
  "manage_orders",
  "manage_products",
  "add_product",
  "add_admin",
  "post_invoices",
  "audit_logs",
  "admin_activity",
  "edit_admin_permissions",
  "sale_receipts",
];
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const ADMIN_LOCK_MINUTES = 15;
const PASSWORD_RESET_TOKEN_TTL_MINUTES = 15;
const ADMIN_LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS_PER_IP = 30;
const CLOUDINARY_UPLOAD_FOLDER = process.env.CLOUDINARY_FOLDER || "laguste-products";
const CLOUDINARY_CLOUD_NAME =
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.VITE_CLOUDINARY_CLOUD_NAME ||
  "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_PRODUCT_IMAGE_TRANSFORMATION = "c_fill,g_auto,w_480,h_600,q_auto,f_auto";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;
const adminLoginRateMap = new Map();

const generateInvoiceNumber = () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `INV-${stamp}-${randomPart}`;
};

const generateReceiptNumber = () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `REC-${stamp}-${randomPart}`;
};

const resolveProductStock = (product) => {
  const stockValue = Number(product?.stock);
  if (Number.isFinite(stockValue)) {
    return stockValue;
  }

  const legacyQuantity = Number(product?.get?.("quantity"));
  if (Number.isFinite(legacyQuantity)) {
    return legacyQuantity;
  }

  return 0;
};

const buildInvoiceItemsFromRequest = async (rawItems, options = {}) => {
  const inventoryAction = options.inventoryAction === "in" ? "in" : "out";

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("Invoice must contain at least one item");
  }

  const invoiceItems = [];
  let totalQuantity = 0;
  let totalAmount = 0;

  for (const rawItem of rawItems) {
    const productId = String(rawItem?.productId || rawItem?._id || "").trim();
    const quantity = Number(rawItem?.quantity ?? rawItem?.cartQuantity ?? 0);

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new Error(`Invalid product id for invoice item ${rawItem?.name || "unknown"}`);
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for invoice item ${rawItem?.name || productId}`);
    }

    const product = await Products.findById(productId);

    if (!product) {
      throw new Error(`Product not found for invoice item ${rawItem?.name || productId}`);
    }

    const availableStock = resolveProductStock(product);

    if (inventoryAction === "out" && availableStock < quantity) {
      throw new Error(`Insufficient stock for ${product.name}. Available: ${availableStock}`);
    }

    const unitPrice = Number(rawItem?.unitPrice ?? rawItem?.price ?? product.price ?? 0);
    const lineTotal = unitPrice * quantity;

    invoiceItems.push({
      productId: product._id.toString(),
      name: rawItem?.name || product.name,
      quantity,
      unitPrice,
      lineTotal,
    });

    totalQuantity += quantity;
    totalAmount += lineTotal;
  }

  return {
    invoiceItems,
    totalQuantity,
    totalAmount,
  };
};

const decrementInvoiceStock = async (invoiceItems) => {
  for (const invoiceItem of invoiceItems) {
    await Products.findByIdAndUpdate(invoiceItem.productId, {
      $inc: { stock: -invoiceItem.quantity },
    });
  }
};

const applyInvoiceStockMovement = async (invoiceItems, inventoryAction) => {
  const movement = inventoryAction === "in" ? 1 : -1;

  for (const invoiceItem of invoiceItems) {
    await Products.findByIdAndUpdate(invoiceItem.productId, {
      $inc: { stock: movement * invoiceItem.quantity },
    });
  }
};

const mapInvoiceErrorStatus = (message) => {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("invoice must contain at least one item") ||
    text.includes("invalid product id") ||
    text.includes("invalid quantity") ||
    text.includes("insufficient stock") ||
    text.includes("supplier name is required")
  ) {
    return 400;
  }

  if (text.includes("product not found")) {
    return 404;
  }

  return 500;
};

const getMissingCloudinaryConfigKeys = () => {
  const missing = [];

  if (!CLOUDINARY_CLOUD_NAME) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!CLOUDINARY_API_KEY) missing.push("CLOUDINARY_API_KEY");
  if (!CLOUDINARY_API_SECRET) missing.push("CLOUDINARY_API_SECRET");

  return missing;
};

const isAdminLoginRateLimited = (ipAddress) => {
  const now = Date.now();
  const current = adminLoginRateMap.get(ipAddress);

  if (!current || now > current.windowStart + ADMIN_LOGIN_RATE_WINDOW_MS) {
    adminLoginRateMap.set(ipAddress, { count: 1, windowStart: now });
    return false;
  }

  current.count += 1;
  adminLoginRateMap.set(ipAddress, current);

  return current.count > ADMIN_LOGIN_MAX_ATTEMPTS_PER_IP;
};

const isStrongPassword = (password) => {
  if (typeof password !== "string") return false;

  // At least 8 chars, upper, lower, number, special.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/.test(password);
};

const getMissingEmailConfigKeys = () => {
  const missing = [];
  if (!SMTP_HOST) missing.push("SMTP_HOST");
  if (!SMTP_PORT) missing.push("SMTP_PORT");
  if (!SMTP_USER) missing.push("SMTP_USER");
  if (!SMTP_PASS) missing.push("SMTP_PASS");
  if (!EMAIL_FROM) missing.push("EMAIL_FROM");

  // Treat template/example placeholders as missing to avoid confusing SMTP runtime errors.
  const placeholderValues = new Set([
    "smtp.example.com",
    "your_smtp_username",
    "your_smtp_password",
    "no-reply@example.com",
    "example@example.com",
  ]);

  if (placeholderValues.has(String(SMTP_HOST).trim().toLowerCase())) missing.push("SMTP_HOST");
  if (placeholderValues.has(String(SMTP_USER).trim().toLowerCase())) missing.push("SMTP_USER");
  if (placeholderValues.has(String(SMTP_PASS).trim().toLowerCase())) missing.push("SMTP_PASS");
  if (placeholderValues.has(String(EMAIL_FROM).trim().toLowerCase())) missing.push("EMAIL_FROM");

  return missing;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findAdminByUsername = async (username) => {
  const trimmed = String(username || "").trim();
  if (!trimmed) return null;

  return AdminModel.findOne({
    username: {
      $regex: `^${escapeRegex(trimmed)}$`,
      $options: "i",
    },
  });
};

const findCustomerByEmail = async (email) => {
  const trimmed = String(email || "").trim();
  if (!trimmed) return null;
  return Customer.findOne({
    email: {
      $regex: `^${escapeRegex(trimmed)}$`,
      $options: "i",
    },
  });
};

const sendPasswordResetTokenEmail = async ({ to, accountLabel, token }) => {
  const missingEmailConfig = getMissingEmailConfigKeys();
  if (missingEmailConfig.length > 0) {
    const error = new Error(`Email service is not configured: ${missingEmailConfig.join(", ")}`);
    error.missingConfig = missingEmailConfig;
    throw error;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  const ttlMinutes = PASSWORD_RESET_TOKEN_TTL_MINUTES;
  const subject = `Laguste ${accountLabel} password reset code`;
  const text = [
    `Your ${accountLabel} password reset token is: ${token}`,
    `This token expires in ${ttlMinutes} minutes.`,
    "If you did not request this, ignore this email.",
  ].join("\n");

  await transporter.sendMail({
    from: EMAIL_FROM,
    to,
    subject,
    text,
  });
};
/* ---------------- CLOUDINARY IMAGE HELPERS ---------------- */

const isCloudinaryProductImageUrl = (value) => {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  if (!CLOUDINARY_CLOUD_NAME) {
    return false;
  }

  const expectedPrefix = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/`;
  return trimmed.startsWith(expectedPrefix);
};

const uploadRemoteImageUrlToCloudinary = async (imageUrl) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `folder=${CLOUDINARY_UPLOAD_FOLDER}&timestamp=${timestamp}&transformation=${CLOUDINARY_PRODUCT_IMAGE_TRANSFORMATION}`;
  const signature = crypto
    .createHash("sha1")
    .update(`${paramsToSign}${CLOUDINARY_API_SECRET}`)
    .digest("hex");

  const formData = new URLSearchParams();
  formData.set("file", imageUrl);
  formData.set("api_key", CLOUDINARY_API_KEY);
  formData.set("timestamp", String(timestamp));
  formData.set("signature", signature);
  formData.set("folder", CLOUDINARY_UPLOAD_FOLDER);
  formData.set("transformation", CLOUDINARY_PRODUCT_IMAGE_TRANSFORMATION);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    }
  );

  const payload = await response.json();
  if (!response.ok || !payload?.secure_url) {
    throw new Error(payload?.error?.message || "Cloudinary migration upload failed");
  }

  return payload.secure_url;
};

const logAdminAudit = async (req, {
  adminId = null,
  username = "",
  action,
  targetType = "",
  targetId = "",
  status = "success",
  details = "",
}) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "";
    const userAgent = req.headers["user-agent"] || "";

    await AdminAuditLog.create({
      adminId,
      username,
      action,
      targetType,
      targetId,
      status,
      details,
      ip,
      userAgent,
    });
  } catch (_err) {
    // Do not block main flow if audit logging fails.
  }
};

const requireSuperAdmin = (req, res, next) => {
  if (req.admin?.role === "superadmin") {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Only superadmin can perform this action",
  });
};

const requirePermission = (permission) => (req, res, next) => {
  if (req.admin?.role === "superadmin") {
    return next();
  }

  const permissions = Array.isArray(req.admin?.permissions)
    ? req.admin.permissions
    : [];

  if (!permissions.includes(permission)) {
    return res.status(403).json({
      success: false,
      message: `Missing required permission: ${permission}`,
    });
  }

  return next();
};

const normalizeBooleanValue = (value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return false;
};

const normalizeProductPayload = (body = {}, options = {}) => {
  const normalizedBody = { ...(body || {}) };
  const defaultShowInNewProducts = options.defaultShowInNewProducts;

  if (Object.prototype.hasOwnProperty.call(normalizedBody, "showInNewProducts")) {
    normalizedBody.showInNewProducts = normalizeBooleanValue(normalizedBody.showInNewProducts);
  } else if (typeof defaultShowInNewProducts === "boolean") {
    normalizedBody.showInNewProducts = defaultShowInNewProducts;
  }

  return normalizedBody;
};

const serializeProduct = (product) => {
  const plainProduct = product?.toObject ? product.toObject() : product;

  return {
    ...plainProduct,
    showInNewProducts: normalizeBooleanValue(plainProduct?.showInNewProducts),
  };
};

/* ---------------- CONNECT DB ---------------- */
const startServer = () => {
  app.listen(ports, () => {
    console.log(`Server is running on port ${ports}`);
  });

  if (!mongoUri) {
    console.error("MONGO_URI is not set");
    return;
  }

  mongoose
    .connect(mongoUri)
    .then(() => {
      console.log("MongoDB connected");
    })
    .catch((err) => {
      console.error("MongoDB connection failed", err);
    });
};


/* ---------------- PRODUCTS ---------------- */
app.get(["/Products", "/products", "/allproducts"], async (req, res) => {
  try {
    const products = await Products.find();
    res.json(products.map(serializeProduct));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ---------------- REGISTER ---------------- */
app.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;

    const existing = await Customer.findOne({ email });
    if (existing) return res.status(409).json({ message: "User exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await Customer.create({
      first_name,
      last_name,
      email,
      password: hashedPassword,
    });

    res.status(201).json({ message: "Registered", user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- LOGIN ---------------- */
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const customer = await findCustomerByEmail(email);
    if (!customer) return res.status(401).json({ message: "Invalid login" });

    const match = await bcrypt.compare(password, customer.password);
    if (!match) return res.status(401).json({ message: "Invalid login" });

  res.status(200).json({
  message: "Login successful",
  user: {
    id: customer._id,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    profileImage: customer.profileImage || ""
  }
});

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- ORDERS (FIXED) ---------------- */
app.post(["/api/orders", "/api/orders/"], async (req, res) => {
  try {
    const { customer, orderItems, totalAmount, user } = req.body;

    const normalizedCustomer = {
      name: customer?.name || user?.name || "",
      email: customer?.email || user?.email || "",
      phone: customer?.phone || "",
      address: customer?.address || "",
    };

    const newOrder = new Order({
      customer: normalizedCustomer,
      orderItems,
      totalAmount,
      user,
    });

    await newOrder.save();

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: newOrder,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get(["/api/orders", "/api/orders/"], async (req, res) => {
  try {
    const { phone, email } = req.query;
    const lookup = (phone || email || "").trim();

    if (!lookup) {
      return res.status(400).json({ message: "Phone number or email address is required" });
    }

    const query = {
      $or: [
        { "customer.phone": lookup },
        { "customer.email": lookup },
        { "user.email": lookup },
      ],
    };

    const orders = await Order.find(query).sort({ createdAt: -1 });

    res.status(200).json({ orders });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
/* ---------------- DELETE ORDER (FIXED) ---------------- */
app.delete(["/api/orders/:id", "/api/orders/:id/"], async (req, res) => {
  try {
    const { id } = req.params;
    const requesterEmail = String(req.body?.email || "").trim().toLowerCase();
    const pendingStatuses = new Set(["pending", "processing", "approved"]);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    if (!requesterEmail) {
      return res.status(400).json({ message: "Customer email is required" });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const orderCustomerEmail = String(order.customer?.email || "").trim().toLowerCase();
    const orderUserEmail = String(order.user?.email || "").trim().toLowerCase();
    const normalizedStatus = String(order.status || "pending").trim().toLowerCase();

    if (requesterEmail !== orderCustomerEmail && requesterEmail !== orderUserEmail) {
      return res.status(403).json({ message: "You can only delete your own orders" });
    }

    if (!pendingStatuses.has(normalizedStatus)) {
      return res.status(403).json({ message: "Only pending orders can be deleted" });
    }

    await Order.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

/* ---------------- GET ONE PRODUCT ---------------- */
app.get(["/Products/:id", "/products/:id"], async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const product = await Products.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(serializeProduct(product));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ================= ADMIN LOGIN ================= */

app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const normalizedUsername = String(username || "").trim();
    const requestIp = req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "";

    if (isAdminLoginRateLimited(requestIp)) {
      await logAdminAudit(req, {
        username: normalizedUsername,
        action: "admin_login",
        status: "failure",
        details: "Rate limit exceeded",
      });

      return res.status(429).json({
        success: false,
        message: "Too many login attempts from this IP. Please try again later.",
      });
    }

    const adminUser = await findAdminByUsername(normalizedUsername);

    if (!adminUser) {
      await logAdminAudit(req, {
        username: normalizedUsername,
        action: "admin_login",
        status: "failure",
        details: "Unknown username",
      });
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (adminUser.lockUntil && adminUser.lockUntil > new Date()) {
      const minutesLeft = Math.max(
        1,
        Math.ceil((adminUser.lockUntil.getTime() - Date.now()) / (1000 * 60))
      );

      await logAdminAudit(req, {
        adminId: adminUser._id,
        username: adminUser.username,
        action: "admin_login",
        status: "failure",
        details: `Account locked for ${minutesLeft} more minute(s)`,
      });

      return res.status(423).json({
        success: false,
        message: `Account locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    if (!adminUser.approved) {
      await logAdminAudit(req, {
        adminId: adminUser._id,
        username: adminUser.username,
        action: "admin_login",
        status: "failure",
        details: "Account not approved",
      });
      return res.status(403).json({
        success: false,
        message: "Your admin account is waiting for approval.",
      });
    }

    const match = await bcrypt.compare(password, adminUser.password);

    if (!match) {
      adminUser.failedLoginAttempts = (adminUser.failedLoginAttempts || 0) + 1;
      if (adminUser.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        adminUser.lockUntil = new Date(Date.now() + ADMIN_LOCK_MINUTES * 60 * 1000);
      }
      await adminUser.save();

      await logAdminAudit(req, {
        adminId: adminUser._id,
        username: adminUser.username,
        action: "admin_login",
        status: "failure",
        details: "Invalid password",
      });

      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    if (adminUser.failedLoginAttempts || adminUser.lockUntil) {
      adminUser.failedLoginAttempts = 0;
      adminUser.lockUntil = null;
      await adminUser.save();
    }

    const token = jwt.sign(
      {
        id: adminUser._id,
        username: adminUser.username,
        role: adminUser.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: adminUser._id,
        first_name: adminUser.first_name,
        last_name: adminUser.last_name,
        username: adminUser.username,
        email: adminUser.email,
        role: adminUser.role,
        permissions: adminUser.permissions || [],
        approved: adminUser.approved,
      },
    });

    await logAdminAudit(req, {
      adminId: adminUser._id,
      username: adminUser.username,
      action: "admin_login",
      status: "success",
      details: "Login successful",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= ADMIN FORGOT/RESET PASSWORD ================= */

app.post("/admin/forgot-password/request", async (req, res) => {
  try {
    const { username, email } = req.body;
    const normalizedUsername = String(username || "").trim();

    if (!normalizedUsername || !email) {
      return res.status(400).json({
        success: false,
        message: "username and email are required",
      });
    }

    const genericMessage = "If the account exists, a reset token has been sent to the registered email.";
    const adminUser = await findAdminByUsername(normalizedUsername);

    if (!adminUser || adminUser.email.toLowerCase() !== String(email).toLowerCase()) {
      await logAdminAudit(req, {
        username: normalizedUsername,
        action: "admin_forgot_password_request",
        status: "failure",
        details: "Username/email mismatch",
      });

      return res.json({ success: true, message: genericMessage });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    adminUser.passwordResetTokenHash = tokenHash;
    adminUser.passwordResetTokenExpires = new Date(
      Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000
    );
    await adminUser.save();

    try {
      const recipientEmail = adminUser.email || process.env.OWNER_EMAIL || SMTP_USER || EMAIL_FROM;
      await sendPasswordResetTokenEmail({
        to: recipientEmail,
        accountLabel: "admin",
        token: resetToken,
      });
    } catch (emailError) {
      adminUser.passwordResetTokenHash = "";
      adminUser.passwordResetTokenExpires = null;
      await adminUser.save();

      return res.status(500).json({
        success: false,
        message: emailError.message,
        missingConfig: Array.isArray(emailError.missingConfig) ? emailError.missingConfig : undefined,
      });
    }

    await logAdminAudit(req, {
      adminId: adminUser._id,
      username: adminUser.username,
      action: "admin_forgot_password_request",
      status: "success",
      details: "Reset token generated",
    });

    return res.json({
      success: true,
      message: genericMessage,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/admin/forgot-password/reset", async (req, res) => {
  try {
    const { username, token, newPassword } = req.body;
    const normalizedUsername = String(username || "").trim();

    if (!normalizedUsername || !token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "username, token and newPassword are required",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 chars and include uppercase, lowercase, number and special character",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const adminUser = await findAdminByUsername(normalizedUsername);

    if (
      !adminUser ||
      adminUser.passwordResetTokenHash !== tokenHash ||
      !adminUser.passwordResetTokenExpires ||
      adminUser.passwordResetTokenExpires <= new Date()
    ) {
      await logAdminAudit(req, {
        username: normalizedUsername,
        action: "admin_forgot_password_reset",
        status: "failure",
        details: "Invalid/expired reset token",
      });

      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    adminUser.password = await bcrypt.hash(newPassword, 10);
    adminUser.passwordResetTokenHash = "";
    adminUser.passwordResetTokenExpires = null;
    adminUser.failedLoginAttempts = 0;
    adminUser.lockUntil = null;
    await adminUser.save();

    await logAdminAudit(req, {
      adminId: adminUser._id,
      username: adminUser.username,
      action: "admin_forgot_password_reset",
      status: "success",
      details: "Password reset successful",
    });

    return res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= CUSTOMER FORGOT/RESET PASSWORD ================= */

app.post("/forgot-password/request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email is required",
      });
    }

    const genericMessage = "If the account exists, a reset token has been sent to the registered email.";
    const customer = await findCustomerByEmail(email);

    if (!customer) {
      return res.json({ success: true, message: genericMessage });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    customer.passwordResetTokenHash = tokenHash;
    customer.passwordResetTokenExpires = new Date(
      Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000
    );
    await customer.save();

    try {
      const recipientEmail = customer.email || process.env.OWNER_EMAIL || SMTP_USER || EMAIL_FROM;
      await sendPasswordResetTokenEmail({
        to: recipientEmail,
        accountLabel: "customer",
        token: resetToken,
      });
    } catch (emailError) {
      customer.passwordResetTokenHash = "";
      customer.passwordResetTokenExpires = null;
      await customer.save();

      return res.status(500).json({
        success: false,
        message: emailError.message,
        missingConfig: Array.isArray(emailError.missingConfig) ? emailError.missingConfig : undefined,
      });
    }

    return res.json({
      success: true,
      message: genericMessage,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/forgot-password/reset", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "email, token and newPassword are required",
      });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 chars and include uppercase, lowercase, number and special character",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const customer = await findCustomerByEmail(email);

    if (
      !customer ||
      customer.passwordResetTokenHash !== tokenHash ||
      !customer.passwordResetTokenExpires ||
      customer.passwordResetTokenExpires <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset token",
      });
    }

    customer.password = await bcrypt.hash(newPassword, 10);
    customer.passwordResetTokenHash = "";
    customer.passwordResetTokenExpires = null;
    await customer.save();

    return res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= ADD ADMIN (SUPERADMIN ONLY) ================= */

app.post("/admin/add-admin", adminAuth, requirePermission("add_admin"), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      username,
      email,
      password,
      role,
      permissions,
      approved,
    } = req.body;

    if (!first_name || !last_name || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "first_name, last_name, username, email and password are required",
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 chars and include uppercase, lowercase, number and special character",
      });
    }

    const existingUser = await AdminModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Admin with username or email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const normalizedRole = role === "superadmin" ? "superadmin" : "admin";
    const selectedPermissions = Array.isArray(permissions)
      ? permissions.filter((permission) => ALL_ADMIN_PERMISSIONS.includes(permission))
      : [];

    const admin = await AdminModel.create({
      first_name,
      last_name,
      username,
      email,
      password: hashedPassword,
      role: normalizedRole,
      permissions:
        normalizedRole === "superadmin" ? ALL_ADMIN_PERMISSIONS : selectedPermissions,
      approved: typeof approved === "boolean" ? approved : true,
    });

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "admin_create",
      targetType: "admin",
      targetId: admin._id.toString(),
      status: "success",
      details: `Created admin ${admin.username}`,
    });

    return res.status(201).json({
      success: true,
      message: "Admin created successfully",
      admin: {
        id: admin._id,
        first_name: admin.first_name,
        last_name: admin.last_name,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
        approved: admin.approved,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= GET ALL ORDERS ================= */

app.get("/admin/orders", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      orders,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


/* ================= APPROVE / UPDATE ORDER ================= */

app.delete("/admin/orders/:id", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    await Order.findByIdAndDelete(req.params.id);

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "order_delete",
      targetType: "order",
      targetId: order._id.toString(),
      status: "success",
      details: `Deleted order ${order._id.toString()}`,
    });

    return res.json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.put("/admin/orders/:id", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const nextStatus = req.body.status;
    const updateDoc = { status: nextStatus };

    if (nextStatus === "Approved") {
      const actingAdmin = await AdminModel.findById(req.admin.id).select("username email");
      updateDoc.approvedBy = {
        id: req.admin.id,
        username: actingAdmin?.username || req.admin.username,
        email: actingAdmin?.email || "",
        at: new Date(),
      };
    } else {
      updateDoc.approvedBy = null;
    }

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      updateDoc,
      {
        new: true,
      }
    );

    res.json({
      success: true,
      order: updatedOrder,
    });

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "order_status_update",
      targetType: "order",
      targetId: req.params.id,
      status: "success",
      details: `Set status to ${nextStatus}`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/admin/orders/:id/invoice", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const { id } = req.params;
    const requestedInvoiceNumber = String(req.body?.invoiceNumber || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (order.invoice?.invoiceNumber) {
      return res.status(409).json({
        success: false,
        message: "Invoice has already been posted for this order",
      });
    }

    if (String(order.status || "").trim() !== "Approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved orders can be invoiced",
      });
    }

    const invoiceItems = [];
    let totalQuantity = 0;

    for (const item of order.orderItems || []) {
      const quantity = Number(item.cartQuantity ?? item.quantity ?? 0);
      const unitPrice = Number(item.price || 0);
      const orderItemProductId = String(item._id || item.productId || "").trim();

      if (quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for product ${item.name || item._id || "unknown"}`,
        });
      }

      if (!mongoose.Types.ObjectId.isValid(orderItemProductId)) {
        return res.status(400).json({
          success: false,
          message: `Order item ${item.name || "unknown"} is missing a valid product id`,
        });
      }

      const product = await Products.findById(orderItemProductId);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product not found for order item ${item.name || item._id}`,
        });
      }

      const availableStock = resolveProductStock(product);

      if (availableStock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${availableStock}`,
        });
      }

      invoiceItems.push({
        productId: product._id.toString(),
        name: item.name || product.name,
        quantity,
        unitPrice,
        lineTotal: unitPrice * quantity,
      });
      totalQuantity += quantity;
    }

    for (const invoiceItem of invoiceItems) {
      await Products.findByIdAndUpdate(invoiceItem.productId, {
        $inc: { stock: -invoiceItem.quantity },
      });
    }

    order.invoice = {
      invoiceNumber: requestedInvoiceNumber || generateInvoiceNumber(),
      postedAt: new Date(),
      postedBy: {
        id: req.admin.id,
        username: req.admin.username,
        email: req.admin.email,
      },
      items: invoiceItems,
      totalQuantity,
      totalAmount: Number(order.totalAmount || 0),
    };

    await order.save();

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "order_invoice_post",
      targetType: "order",
      targetId: order._id.toString(),
      status: "success",
      details: `Posted invoice ${order.invoice.invoiceNumber}`,
    });

    return res.json({
      success: true,
      message: "Invoice posted successfully",
      order,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.delete("/admin/invoices/:id", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice id",
      });
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    await Invoice.findByIdAndDelete(req.params.id);

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "invoice_delete",
      targetType: "invoice",
      targetId: invoice._id.toString(),
      status: "success",
      details: `Deleted invoice ${invoice.invoiceNumber || invoice._id.toString()}`,
    });

    return res.json({
      success: true,
      message: "Invoice deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.get("/admin/invoices", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const invoices = await Invoice.find({}).sort({ postedAt: -1, createdAt: -1 }).lean();

    return res.json({
      success: true,
      invoices,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.get("/admin/supplier-invoices", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const invoices = await Invoice.find({ sourceType: "supplier" })
      .sort({ invoiceDate: -1, postedAt: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      invoices,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/admin/invoices", adminAuth, requirePermission("manage_orders"), async (req, res) => {
  try {
    const requestedInvoiceNumber = String(req.body?.invoiceNumber || "").trim();
    const sourceOrderId = String(req.body?.sourceOrderId || "").trim();
    const requestedSourceType = String(req.body?.sourceType || "").trim().toLowerCase();
    const sourceType = requestedSourceType === "supplier" ? "supplier" : "manual";
    const supplierPayload = req.body?.supplier || {};
    const parsedInvoiceDate = req.body?.invoiceDate ? new Date(req.body.invoiceDate) : new Date();
    const invoiceDate = Number.isNaN(parsedInvoiceDate.getTime()) ? new Date() : parsedInvoiceDate;
    const customerPayload = req.body?.customer || {};
    const providedItems = Array.isArray(req.body?.items) ? req.body.items : [];

    let sourceOrder = null;

    if (sourceOrderId) {
      if (!mongoose.Types.ObjectId.isValid(sourceOrderId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid source order id",
        });
      }

      sourceOrder = await Order.findById(sourceOrderId);

      if (!sourceOrder) {
        return res.status(404).json({
          success: false,
          message: "Source order not found",
        });
      }

      if (sourceOrder.invoice?.invoiceNumber) {
        return res.status(409).json({
          success: false,
          message: "An invoice has already been posted for this order",
        });
      }
    }

    const normalizedSourceType = sourceOrder ? "order" : sourceType;
    const inventoryAction = normalizedSourceType === "supplier" ? "in" : "out";

    const invoiceNumber = requestedInvoiceNumber || generateInvoiceNumber();
    const existingInvoice = await Invoice.findOne({ invoiceNumber });

    if (existingInvoice) {
      return res.status(409).json({
        success: false,
        message: "Invoice number already exists",
      });
    }

    const resolvedCustomer = {
      name: String(customerPayload.name || sourceOrder?.customer?.name || sourceOrder?.user?.name || "").trim(),
      email: String(customerPayload.email || sourceOrder?.customer?.email || sourceOrder?.user?.email || "").trim(),
      phone: String(customerPayload.phone || sourceOrder?.customer?.phone || "").trim(),
      address: String(customerPayload.address || sourceOrder?.customer?.address || "").trim(),
    };

    const resolvedSupplier = {
      name: String(supplierPayload.name || "").trim(),
      contact: String(supplierPayload.contact || "").trim(),
    };

    if (normalizedSourceType === "supplier" && !resolvedSupplier.name) {
      return res.status(400).json({
        success: false,
        message: "Supplier name is required for supplier invoices",
      });
    }

    const fallbackOrderItems = (sourceOrder?.orderItems || []).map((item) => ({
      productId: item._id || item.productId,
      name: item.name,
      quantity: item.cartQuantity ?? item.quantity ?? 0,
      unitPrice: item.price,
    }));

    const rawItems = providedItems.length > 0 ? providedItems : fallbackOrderItems;
    const { invoiceItems, totalQuantity, totalAmount } = await buildInvoiceItemsFromRequest(rawItems, {
      inventoryAction,
    });

    await applyInvoiceStockMovement(invoiceItems, inventoryAction);

    const invoice = await Invoice.create({
      invoiceNumber,
      sourceOrderId: sourceOrder?._id?.toString() || "",
      sourceType: normalizedSourceType,
      inventoryAction,
      invoiceDate,
      supplier: resolvedSupplier,
      customer: resolvedCustomer,
      items: invoiceItems,
      totalQuantity,
      totalAmount,
      postedBy: {
        id: req.admin.id,
        username: req.admin.username,
        email: req.admin.email,
      },
      postedAt: new Date(),
      receipt: {
        receiptNumber: generateReceiptNumber(),
        issuedAt: new Date(),
      },
    });

    if (sourceOrder) {
      sourceOrder.invoice = {
        invoiceNumber: invoice.invoiceNumber,
        postedAt: invoice.postedAt,
        postedBy: invoice.postedBy,
        items: invoiceItems,
        totalQuantity,
        totalAmount,
      };

      await sourceOrder.save();
    }

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "invoice_post",
      targetType: "invoice",
      targetId: invoice._id.toString(),
      status: "success",
      details: `Posted invoice ${invoice.invoiceNumber}`,
    });

    return res.status(201).json({
      success: true,
      message: "Invoice posted successfully",
      invoice,
    });
  } catch (err) {
    const status = mapInvoiceErrorStatus(err?.message);
    return res.status(status).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= ADMIN ACTIVITY (SUPERADMIN ONLY) ================= */

app.get("/admin/admin-activity", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await AdminModel.find({}, "first_name last_name username email role permissions approved createdAt").sort({ createdAt: -1 }).lean();

    const adminsWithActivity = await Promise.all(
      admins.map(async (admin) => {
        const approvedOrders = await Order.find(
          {
            status: "Approved",
            "approvedBy.id": admin._id.toString(),
          },
          "_id totalAmount customer status approvedBy createdAt updatedAt"
        )
          .sort({ updatedAt: -1 })
          .lean();

        return {
          ...admin,
          approvedOrdersCount: approvedOrders.length,
          approvedOrders,
        };
      })
    );

    return res.json({
      success: true,
      admins: adminsWithActivity,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= ADMIN MANAGEMENT (SUPERADMIN ONLY) ================= */

app.get("/admin/admins", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await AdminModel.find(
      {},
      "first_name last_name username email role permissions approved createdAt"
    )
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      admins,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.delete("/admin/admins/:id", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid admin id",
      });
    }

    const targetAdmin = await AdminModel.findById(req.params.id);
    if (!targetAdmin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    if (targetAdmin._id.toString() === req.admin.id) {
      return res.status(403).json({
        success: false,
        message: "You cannot delete your own admin account",
      });
    }

    const remainingSuperAdmins = await AdminModel.countDocuments({
      role: "superadmin",
      _id: { $ne: targetAdmin._id },
    });

    if (targetAdmin.role === "superadmin" && remainingSuperAdmins === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one super admin must remain",
      });
    }

    await AdminModel.findByIdAndDelete(req.params.id);

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "admin_delete",
      targetType: "admin",
      targetId: targetAdmin._id.toString(),
      status: "success",
      details: `Deleted admin ${targetAdmin.username}`,
    });

    return res.json({
      success: true,
      message: "Admin deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.put("/admin/admins/:id", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const targetAdmin = await AdminModel.findById(req.params.id);
    if (!targetAdmin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    const { role, permissions, approved } = req.body;
    const normalizedRole = role === "superadmin" ? "superadmin" : "admin";
    const selectedPermissions = Array.isArray(permissions)
      ? permissions.filter((permission) => ALL_ADMIN_PERMISSIONS.includes(permission))
      : [];

    targetAdmin.role = normalizedRole;
    targetAdmin.permissions =
      normalizedRole === "superadmin" ? ALL_ADMIN_PERMISSIONS : selectedPermissions;

    if (typeof approved === "boolean") {
      targetAdmin.approved = approved;
    }

    await targetAdmin.save();

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "admin_update",
      targetType: "admin",
      targetId: targetAdmin._id.toString(),
      status: "success",
      details: `Updated role=${targetAdmin.role}, approved=${targetAdmin.approved}`,
    });

    return res.json({
      success: true,
      message: "Admin updated successfully",
      admin: {
        id: targetAdmin._id,
        first_name: targetAdmin.first_name,
        last_name: targetAdmin.last_name,
        username: targetAdmin.username,
        email: targetAdmin.email,
        role: targetAdmin.role,
        permissions: targetAdmin.permissions,
        approved: targetAdmin.approved,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.delete("/admin/audit-logs/:id", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid audit log id",
      });
    }

    const log = await AdminAuditLog.findById(req.params.id);
    if (!log) {
      return res.status(404).json({
        success: false,
        message: "Audit log not found",
      });
    }

    await AdminAuditLog.findByIdAndDelete(req.params.id);

    return res.json({
      success: true,
      message: "Audit log deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.get("/admin/audit-logs", adminAuth, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await AdminAuditLog.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      success: true,
      logs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


/* ================= GET ALL PRODUCTS ================= */

app.get("/admin/products", adminAuth, requirePermission("manage_products"), async (req, res) => {
  try {
    const products = await Products.find();

    res.json({
      success: true,
      products: products.map(serializeProduct),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

/* ================= CLOUDINARY SIGNED UPLOAD ================= */

app.post("/admin/cloudinary/sign-upload", adminAuth, requirePermission("add_product"), async (req, res) => {
  try {
    const missingConfig = getMissingCloudinaryConfigKeys();
    if (missingConfig.length > 0) {
      return res.status(500).json({
        success: false,
        message: "Cloudinary server configuration is incomplete",
        missingConfig,
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = `folder=${CLOUDINARY_UPLOAD_FOLDER}&timestamp=${timestamp}&transformation=${CLOUDINARY_PRODUCT_IMAGE_TRANSFORMATION}`;
    const signature = crypto
      .createHash("sha1")
      .update(`${paramsToSign}${CLOUDINARY_API_SECRET}`)
      .digest("hex");

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "cloudinary_upload_signature",
      targetType: "cloudinary",
      status: "success",
      details: `Generated signed upload parameters for folder ${CLOUDINARY_UPLOAD_FOLDER}`,
    });

    return res.json({
      success: true,
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      folder: CLOUDINARY_UPLOAD_FOLDER,
      transformation: CLOUDINARY_PRODUCT_IMAGE_TRANSFORMATION,
      timestamp,
      signature,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


/* ================= ADD PRODUCT ================= */

app.post("/admin/products", adminAuth, requirePermission("add_product"), async (req, res) => {
  try {
    if (!isCloudinaryProductImageUrl(req.body?.img)) {
      return res.status(400).json({
        success: false,
        message: "Product image must be uploaded to Cloudinary before saving",
      });
    }

    const productPayload = normalizeProductPayload(req.body, { defaultShowInNewProducts: false });
    productPayload.showInNewProducts = normalizeBooleanValue(productPayload.showInNewProducts);
    const product = new Products(productPayload);
    await product.save();
    res.status(201).json({
      success: true,
      product: serializeProduct(product),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


/* ================= EDIT PRODUCT ================= */

app.put("/admin/products/:id", adminAuth, requirePermission("manage_products"), async (req, res) => {
  try {
    if (typeof req.body?.img !== "undefined" && !isCloudinaryProductImageUrl(req.body.img)) {
      return res.status(400).json({
        success: false,
        message: "Product image must be a Cloudinary URL",
      });
    }

    const productPayload = normalizeProductPayload(req.body);
    productPayload.showInNewProducts = normalizeBooleanValue(productPayload.showInNewProducts);
    const updatedProduct = await Products.findByIdAndUpdate(
      req.params.id,
      productPayload,
      {
        new: true,
      }
    );
    res.json({
      success: true,
      product: updatedProduct ? serializeProduct(updatedProduct) : null,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/admin/products/migrate-images-to-cloudinary", adminAuth, requirePermission("manage_products"), async (req, res) => {
  try {
    const missingConfig = getMissingCloudinaryConfigKeys();
    if (missingConfig.length > 0) {
      return res.status(500).json({
        success: false,
        message: "Cloudinary server configuration is incomplete",
        missingConfig,
      });
    }

    const products = await Products.find({});
    const migrated = [];
    const skipped = [];
    const failed = [];

    for (const product of products) {
      const currentImage = String(product.img || "").trim();

      if (!currentImage) {
        skipped.push({ productId: product._id.toString(), reason: "Missing image" });
        continue;
      }

      if (isCloudinaryProductImageUrl(currentImage)) {
        skipped.push({ productId: product._id.toString(), reason: "Already Cloudinary" });
        continue;
      }

      if (!/^https?:\/\//i.test(currentImage)) {
        skipped.push({
          productId: product._id.toString(),
          reason: "Not a public URL (likely local asset key)",
          image: currentImage,
        });
        continue;
      }

      try {
        const secureUrl = await uploadRemoteImageUrlToCloudinary(currentImage);
        product.img = secureUrl;
        await product.save();

        migrated.push({
          productId: product._id.toString(),
          from: currentImage,
          to: secureUrl,
        });
      } catch (migrationError) {
        failed.push({
          productId: product._id.toString(),
          image: currentImage,
          reason: migrationError.message,
        });
      }
    }

    await logAdminAudit(req, {
      adminId: req.admin.id,
      username: req.admin.username,
      action: "product_image_migration_to_cloudinary",
      targetType: "product",
      status: failed.length > 0 ? "failure" : "success",
      details: `Migrated=${migrated.length}, Skipped=${skipped.length}, Failed=${failed.length}`,
    });

    return res.json({
      success: true,
      summary: {
        totalProducts: products.length,
        migrated: migrated.length,
        skipped: skipped.length,
        failed: failed.length,
      },
      migrated,
      skipped,
      failed,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});



/* ================= DELETE PRODUCT ================= */

app.delete("/admin/products/:id", adminAuth, requirePermission("manage_products"), async (req, res) => {
  try {
    await Products.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


/* ---------------- START SERVER ---------------- */
startServer();