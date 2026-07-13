const rateLimit = require('express-rate-limit');

// Auth limiter — tight window on login/register to stop credential stuffing.
// 20 attempts per 15 minutes per IP; after that the attacker must wait.
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_AUTH_MAX)   || 20,
  standardHeaders: true,  // Return rate limit info in RateLimit-* headers
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

// General API limiter — looser, covers all /api/* routes.
// Stops bulk scraping and general abuse without affecting normal usage.
// Skips /api/location, which is a high-frequency ingest path with its own limiter.
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_API_MAX)   || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/location',
});

// Location ingest limiter — background trackers post here continuously.
//
// Keyed by USER, not IP: several friends on the same mobile carrier can share a
// NAT IP, and an IP-keyed limit would let one person exhaust everyone's budget.
// verifyToken runs before this, so req.user is always populated.
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_LOCATION_MAX) || 60, // ~1/sec per user
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many location updates.' },
  keyGenerator: (req) => `u:${req.user.userId}`, // JWT payload is { userId, username }
});

module.exports = { authLimiter, apiLimiter, locationLimiter };
