const Redis = require('ioredis');

// Shared Redis client for direct commands (geofence enter/exit state). This is
// SEPARATE from the pub/sub clients in server.js — a client in subscriber mode
// cannot run normal commands, so direct reads/writes need their own connection.
//
// Managed Redis (Redis Cloud, Upstash) hands you a single REDIS_URL, often
// rediss:// for TLS. Local dev uses discrete host/port. URL wins when present.
//
// maxRetriesPerRequest: null — keep retrying rather than throwing. Redis being
// briefly down must never crash the app.
const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
    });

// Log the first connection error then suppress (re-armed on connect) so a Redis
// outage doesn't flood the console with one line per retry. Geofence state
// (the only consumer) simply won't track enter/exit transitions while Redis is down.
let clientErrorLogged = false;
redisClient.on('connect', () => {
  clientErrorLogged = false;
  console.log('Redis client connected');
});
redisClient.on('error', (err) => {
  if (clientErrorLogged) return;
  clientErrorLogged = true;
  console.warn(`Redis client unavailable (${err.message || 'connection failed'}) — geofence state falls back to in-memory (fine for a single instance). Further errors suppressed.`);
});

module.exports = redisClient;
