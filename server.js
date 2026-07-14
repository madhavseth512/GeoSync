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
const createLocationRouter = require('./src/routes/location');
const { apiLimiter } = require('./src/middleware/rate-limiter');
const { socketAuthMiddleware } = require('./src/socket/middleware');
const { registerSocketHandlers } = require('./src/socket/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Behind a cloud proxy (Render, etc.) every request arrives from the proxy's IP.
// Without this, express-rate-limit would key all users to that single address —
// one person could burn down everyone's budget — and v7 warns about the
// misconfiguration. Trust exactly one hop; never enable this when not proxied,
// as clients could then spoof X-Forwarded-For to dodge rate limits.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// ── Socket.IO adapter ────────────────────────────────────────────────────────
// The Redis Pub/Sub adapter exists to fan broadcasts out across MULTIPLE Node
// instances. It is opt-in (USE_REDIS_ADAPTER=true) for a deliberate reason: with
// a single instance there are no peers to fan out to, so the adapter would cost a
// Redis PUBLISH on every broadcast for zero benefit — real money on a metered
// free tier. Production runs single-instance; the multi-instance path is kept and
// switched on by config.
//
// Verified (Phase 5): two instances (PORT=3000 and PORT=3001), a client on each,
// both in the same room — a location emitted on 3000 was received on 3001 via
// Redis. With Redis unreachable the server still serves HTTP without crashing.
//
// NOTE: this is separate from src/redis.js, which holds geofence state. That
// client is always available; only the broadcast adapter is gated here.
if (process.env.USE_REDIS_ADAPTER === 'true') {
  // Pub/Sub needs two connections: a subscriber cannot also issue normal commands.
  // Managed Redis supplies a single REDIS_URL; local dev uses discrete host/port.
  //
  // maxRetriesPerRequest: null — retry forever rather than throwing after 20
  // attempts. Without it, queued adapter commands raise an unhandled
  // MaxRetriesPerRequestError and kill the process when Redis is down.
  const pubClient = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
      });
  const subClient = pubClient.duplicate();

  // Log only the FIRST error, then suppress (re-armed on reconnect), so an outage
  // doesn't flood the console with a line per retry.
  let adapterErrorLogged = false;
  const onAdapterError = (err) => {
    if (adapterErrorLogged) return;
    adapterErrorLogged = true;
    console.warn(
      `Redis adapter unavailable (${err.message || 'connection failed'}) — broadcasts stay local to this instance. Further errors suppressed.`
    );
  };
  pubClient.on('error', onAdapterError);
  subClient.on('error', onAdapterError);
  pubClient.on('ready', () => { adapterErrorLogged = false; });

  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO: Redis adapter enabled (multi-instance mode)');
} else {
  console.log('Socket.IO: in-memory adapter (single instance). Set USE_REDIS_ADAPTER=true to scale out.');
}

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

// Health check — used by the cloud host (Render) to verify the service is up.
app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

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

// Location ingest — POST /api/location. This is how BACKGROUND tracking reports
// position: a WebSocket can't survive the phone locking, but an HTTP request can.
// Needs `io` so a REST ping broadcasts to the room just like a socket ping.
app.use('/api', createLocationRouter(io));

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
