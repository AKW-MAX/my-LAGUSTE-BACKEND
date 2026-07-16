const jwt = require("jsonwebtoken");
const AdminModel = require("../models/admin");

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

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