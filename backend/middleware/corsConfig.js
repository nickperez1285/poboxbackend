const DEFAULT_ALLOWED_HOSTS = new Set([
  "porchpobox.com",
  "www.porchpobox.com",
  "localhost",
  "127.0.0.1",
]);

const parseExtraOrigins = () => {
  const entries = [
    process.env.FRONTEND_URL,
    process.env.BASE_URL,
    process.env.CORS_EXTRA_ORIGINS,
  ].filter(Boolean);

  const origins = [];
  for (const entry of entries) {
    entry
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => origins.push(value));
  }
  return origins;
};

const hostnameFromOrigin = (origin) => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  const host = hostnameFromOrigin(origin);
  if (!host) {
    return false;
  }

  if (DEFAULT_ALLOWED_HOSTS.has(host)) {
    return true;
  }

  if (host.endsWith(".vercel.app")) {
    return true;
  }

  for (const allowed of parseExtraOrigins()) {
    const allowedHost = hostnameFromOrigin(allowed) || allowed.toLowerCase();
    if (allowedHost === host) {
      return true;
    }
  }

  return false;
};

const corsOriginCallback = (origin, callback) => {
  if (!origin || isAllowedOrigin(origin)) {
    return callback(null, true);
  }

  console.warn(`[CORS] Blocked origin: ${origin}`);
  // Using null, false instead of an Error prevents the server from
  // entering an error state during preflight checks.
  return callback(null, false);
};

const corsOptions = {
  origin: corsOriginCallback,
  credentials: true,
};

module.exports = {
  corsOptions,
  isAllowedOrigin,
};
