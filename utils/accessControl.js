const hasPermission = (permissions = [], requiredPermission = "") => {
  if (typeof requiredPermission !== "string") {
    return false;
  }

  const normalizedPermission = requiredPermission.trim();
  if (!normalizedPermission) {
    return false;
  }

  return Array.isArray(permissions) && permissions.includes(normalizedPermission);
};

const hasAnyPermission = (permissions = [], requiredPermissions = []) => {
  if (!Array.isArray(requiredPermissions) || requiredPermissions.length === 0) {
    return false;
  }

  return requiredPermissions.some((permission) => hasPermission(permissions, permission));
};

const canAccessAdminRoute = (pathname = "", admin = null) => {
  if (!pathname || !admin) {
    return false;
  }

  if (admin.role === "superadmin") {
    return true;
  }

  const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
  const normalizedPath = pathname.toString().trim();

  if (normalizedPath.startsWith("/admin/daily-report")) {
    return hasPermission(permissions, "generate_daily_report");
  }

  if (normalizedPath.startsWith("/admin/region-analytics")) {
    return hasPermission(permissions, "view_region_analytics");
  }

  return false;
};

const createRequirePermission = (requiredPermissions) => (req, res, next) => {
  if (req.admin?.role === "superadmin") {
    return next();
  }

  const permissions = Array.isArray(req.admin?.permissions) ? req.admin.permissions : [];
  const requiredList = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  if (hasAnyPermission(permissions, requiredList)) {
    return next();
  }

  const permissionDescription = requiredList.join(" or ");
  return res.status(403).json({
    success: false,
    message: `Missing required permission: ${permissionDescription}`,
  });
};

module.exports = {
  canAccessAdminRoute,
  createRequirePermission,
  hasAnyPermission,
  hasPermission,
};
