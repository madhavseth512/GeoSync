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
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_API_MAX)   || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

module.exports = { authLimiter, apiLimiter };
