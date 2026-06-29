// GeoSync entry point — wires modules together. No business logic here.
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');

const authRouter = require('./src/routes/auth');
const historyRouter = require('./src/routes/history');
const geofencesRouter = require('./src/routes/geofences');
const heatmapRouter = require('./src/routes/heatmap');
const { apiLimiter } = require('./src/middleware/rate-limiter');
const { socketAuthMiddleware } = require('./src/socket/middleware');
const { registerSocketHandlers } = require('./src/socket/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Redis Pub/Sub adapter — makes Socket.IO broadcasts work across multiple Node
// instances. Pub/Sub needs two separate connections: a subscriber client cannot
// also issue normal commands, so we duplicate the publisher for subscribing.
const pubClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
  // Retry forever instead of throwing after 20 attempts — a Redis outage must be
  // logged, never crash the server (Phase 5 requirement). Without this, queued
  // adapter commands raise an unhandled MaxRetriesPerRequestError when Redis is down.
  maxRetriesPerRequest: null,
});
const subClient = pubClient.duplicate();

// Redis failure must log, not crash — the app still serves a single instance.
// Log only the FIRST error then suppress (reset on reconnect) so a Redis outage
// doesn't flood the console with one line per retry.
let redisAdapterErrorLogged = false;
const onRedisAdapterError = (err) => {
  if (redisAdapterErrorLogged) return;
  redisAdapterErrorLogged = true;
  console.warn(
    `Redis unavailable (${err.message || 'connection failed'}) — running single-instance without the Redis adapter. Further Redis errors suppressed.`
  );
};
pubClient.on('error', onRedisAdapterError);
subClient.on('error', onRedisAdapterError);
pubClient.on('ready', () => { redisAdapterErrorLogged = false; }); // re-arm if Redis returns

// Every io.to(room).emit() is now published through Redis and fanned out to all
// instances subscribed to that channel. Transparent — no handler changes needed.
//
// Verified (Phase 5): ran two instances (PORT=3000 and PORT=3001), connected a
// client to each, both joined the same room. A location emitted on the 3000
// client was received by the 3001 client via Redis. With Redis unreachable the
// server still serves HTTP and logs errors without crashing.
io.adapter(createAdapter(pubClient, subClient));

// Secure HTTP headers — protects against XSS, clickjacking, MIME sniffing, etc.
// CSP is customised to allow the specific external origins GeoSync uses: the
// Leaflet CDN (unpkg + cdnjs + leaflet.github.io for draw/heat plugins) and the
// OpenStreetMap tile server. Everything else stays locked to 'self'.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://leaflet.github.io'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
        // OSM tiles + Leaflet marker icons (served from the CDN) + inline data URIs.
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
        // Socket.IO WebSocket connection to same origin.
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
      },
    },
  })
);

// CORS — only allow requests from the configured client origin, never wildcard.
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));

app.use(express.json());
// Note: GeoSync is now mobile-only (React Native app in mobile/). The backend is
// a pure JSON/Socket.IO API — no static web frontend is served.

// General rate limiter on all API routes — stops bulk scraping and abuse.
app.use('/api', apiLimiter);

// Auth routes (register/login have their own tighter authLimiter applied inside).
app.use('/api', authRouter);

// History routes — protected by verifyToken inside the router.
app.use('/api', historyRouter);

// Geofence routes — POST/GET/DELETE, all protected by verifyToken inside the router.
app.use('/api', geofencesRouter);

// Heatmap route — GET aggregated density points, protected by verifyToken inside.
app.use('/api', heatmapRouter);

// Socket.IO — reject unauthenticated connections before any handler runs.
io.use(socketAuthMiddleware);

// Shared in-memory map: socket.id -> { username, roomCode, lat, lng }.
// Kept in-memory per instance — cross-instance broadcasting is handled by the
// Redis adapter above. Known limitation: the connected-users count is per
// instance; a fully shared roster would store this in Redis too.
const users = {};

io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, users);
});

server.listen(PORT, () => {
  console.log(`GeoSync server running at http://localhost:${PORT}`);
});
