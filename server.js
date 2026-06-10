// GeoSync entry point — wires modules together. No business logic here.
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');

const authRouter = require('./src/routes/auth');
const { apiLimiter } = require('./src/middleware/rate-limiter');
const { socketAuthMiddleware } = require('./src/socket/middleware');
const { registerSocketHandlers } = require('./src/socket/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Secure HTTP headers — protects against XSS, clickjacking, MIME sniffing, etc.
app.use(helmet());

// CORS — only allow requests from the configured client origin, never wildcard.
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// General rate limiter on all API routes — stops bulk scraping and abuse.
app.use('/api', apiLimiter);

// Auth routes (register/login have their own tighter authLimiter applied inside).
app.use('/api', authRouter);

// Socket.IO — reject unauthenticated connections before any handler runs.
io.use(socketAuthMiddleware);

// Shared in-memory map: socket.id -> { username, roomCode, lat, lng }.
// Moves to Redis in Phase 5 for horizontal scaling.
const users = {};

io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, users);
});

server.listen(PORT, () => {
  console.log(`GeoSync server running at http://localhost:${PORT}`);
});
