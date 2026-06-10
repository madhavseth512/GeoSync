const jwt = require('jsonwebtoken');

// Socket.IO auth middleware — runs before every new connection is accepted.
// Rejects unauthenticated sockets before they reach any event handler.
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: no token'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user payload to socket so handlers can read it without re-verifying.
    socket.data.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: invalid token'));
  }
}

module.exports = socketAuthMiddleware;
