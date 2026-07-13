const { checkThrottle, clearThrottle } = require('./middleware');
const { processLocationPing, isValidCoord } = require('../services/location');

// All Socket.IO event handlers — io.to(roomCode).emit() everywhere, never io.emit().

function registerSocketHandlers(io, socket, users) {
  const { userId, username } = socket.data.user;

  console.log(`socket connected: ${socket.id} (${username})`);

  socket.on('join-room', ({ roomCode }) => {
    if (!roomCode || typeof roomCode !== 'string') return;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    users[socket.id] = { username, roomCode };

    io.to(roomCode).emit('user-joined', { username });
    console.log(`${username} joined room ${roomCode}`);
  });

  // Foreground location path. The background path (screen locked) posts to
  // POST /api/location instead — a socket can't survive backgrounding. Both
  // funnel into the same processLocationPing service.
  socket.on('send-location', ({ lat, lng }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    if (!isValidCoord(lat, lng)) return;

    // Throttle — drops the event and disconnects repeat offenders.
    if (!checkThrottle(socket)) return;

    users[socket.id] = { ...users[socket.id], lat, lng };

    processLocationPing(io, { userId, username, roomCode, lat, lng });
  });

  // A geofence was deleted (DB removal already done via authenticated REST).
  // Relay to the rest of the room so the zone disappears from their maps live.
  socket.on('delete-geofence', ({ id }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || typeof id !== 'number') return;
    socket.to(roomCode).emit('geofence-removed', { id });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    console.log(`socket disconnected: ${socket.id} (${username})`);

    // Always clean up throttle state on disconnect to prevent Map memory leak.
    clearThrottle(socket.id);

    // NOTE: we deliberately do NOT remove the user's marker here. With background
    // tracking, a user can have no live socket while still sharing location via
    // REST. Markers are driven by location pings, not socket presence — the
    // client ages out users that stop pinging.
    if (roomCode) {
      io.to(roomCode).emit('user-disconnected', { userId, username });
    }

    delete users[socket.id];
  });
}

module.exports = { registerSocketHandlers };
