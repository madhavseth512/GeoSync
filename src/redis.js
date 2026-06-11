const Redis = require('ioredis');

// Shared Redis client for direct GET/SET operations (geofence state in Phase 7,
// throttle counters if moved off in-memory later). This is SEPARATE from the
// pub/sub clients in server.js — a client in subscriber mode cannot run normal
// commands, so direct reads/writes need their own connection.
const redisClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
  // Keep retrying on failure rather than throwing — Redis being briefly down
  // must not crash the app.
  maxRetriesPerRequest: null,
});

redisClient.on('connect', () => console.log('Redis client connected'));
redisClient.on('error', (err) => console.error('Redis client error:', err.message));

module.exports = redisClient;
