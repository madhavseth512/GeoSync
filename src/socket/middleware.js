const jwt = require('jsonwebtoken');

// Per-socket throttle state — keyed by socket.id, cleaned up on disconnect.
// In-memory only for Phase 4; moves to Redis in Phase 5 so state is shared
// across multiple Node instances.
const throttleMap = new Map();

const THROTTLE_INTERVAL_MS = parseInt(process.env.SOCKET_THROTTLE_INTERVAL_MS) || 4000;
const MAX_VIOLATIONS        = parseInt(process.env.SOCKET_MAX_VIOLATIONS)        || 10;

// Socket.IO auth middleware — runs before every new connection is accepted.
// Rejects unauthenticated sockets before they reach any event handler.
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: no token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
}

// Checks whether a socket's send-location event should be allowed through.
// Returns true if the event is within the allowed rate, false if it should be dropped.
// Disconnects the socket if violations exceed MAX_VIOLATIONS.
function checkThrottle(socket) {
  const now = Date.now();
  const state = throttleMap.get(socket.id) || { lastEmit: 0, violations: 0 };

  if (now - state.lastEmit < THROTTLE_INTERVAL_MS) {
    // Arrived too fast — increment violation counter.
    state.violations += 1;

    if (state.violations > MAX_VIOLATIONS) {
      // Socket is flooding — disconnect it. Reason is logged server-side only;
      // not emitted back to avoid giving the attacker feedback on the exact threshold.
      console.warn(`throttle_exceeded: disconnecting socket ${socket.id}`);
      throttleMap.delete(socket.id);
      socket.disconnect(true);
      return false;
    }

    throttleMap.set(socket.id, state);
    return false; // Drop this event silently.
  }

  // Clean emit — reset violations and update timestamp.
  throttleMap.set(socket.id, { lastEmit: now, violations: 0 });
  return true;
}

function clearThrottle(socketId) {
  throttleMap.delete(socketId);
}

module.exports = { socketAuthMiddleware, checkThrottle, clearThrottle };
