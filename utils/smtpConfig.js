const normalizeSmtpValue = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, "");
};

const normalizeSmtpConfig = (env = process.env) => ({
  host: normalizeSmtpValue(env.SMTP_HOST),
  port: Number(env.SMTP_PORT || 587),
  secure: String(env.SMTP_SECURE || "false").toLowerCase() === "true",
  user: normalizeSmtpValue(env.SMTP_USER),
  pass: normalizeSmtpValue(env.SMTP_PASS),
  from: normalizeSmtpValue(env.EMAIL_FROM || env.SMTP_USER),
});

module.exports = {
  normalizeSmtpConfig,
  normalizeSmtpValue,
};
