const jwt = require("jsonwebtoken");
const AdminModel = require("../models/admin");

const JWT_SECRET = process.env.JWT_SECRET || "laguste-secret";

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const fallbackToken = req.headers["x-admin-token"] || req.query.token || req.query.adminToken || "";
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : fallbackToken;

    if (!rawToken) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const decoded = jwt.verify(rawToken, JWT_SECRET);

    const adminUser = await AdminModel.findById(decoded.id).select(
      "_id username email role permissions approved"
    );

    if (!adminUser) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found",
      });
    }

    if (!adminUser.approved) {
      return res.status(403).json({
        success: false,
        message: "Admin account is not approved",
      });
    }

    req.admin = {
      id: adminUser._id.toString(),
      username: adminUser.username,
      email: adminUser.email,
      role: adminUser.role,
      permissions: adminUser.permissions || [],
      approved: adminUser.approved,
    };

    next();

  } catch (err) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};