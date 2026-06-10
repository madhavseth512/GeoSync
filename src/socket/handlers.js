// All Socket.IO event handlers live here — moved from server.js in Phase 3.
// io.to(roomCode).emit() is used everywhere — never io.emit() after Phase 3.

function registerSocketHandlers(io, socket, users) {
  const { username } = socket.data.user;

  console.log(`socket connected: ${socket.id} (${username})`);

  // Client joins a private room after logging in.
  socket.on('join-room', ({ roomCode }) => {
    if (!roomCode || typeof roomCode !== 'string') return;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    // Store user state so disconnect can broadcast the right room.
    users[socket.id] = { username, roomCode };

    // Scoped to room only — other rooms never see this event.
    io.to(roomCode).emit('user-joined', { username });
    console.log(`${username} joined room ${roomCode}`);
  });

  // Client sends a GPS update — broadcast to everyone else in the same room.
  socket.on('send-location', ({ lat, lng }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    // Basic coordinate sanity check — full validation added in Phase 4.
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    users[socket.id] = { ...users[socket.id], lat, lng };

    // Broadcast to room only — enforces the privacy model.
    io.to(roomCode).emit('receive-location', {
      id: socket.id,
      lat,
      lng,
      username,
    });
  });

  // Clean up shared state on disconnect — never leave stale entries.
  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    console.log(`socket disconnected: ${socket.id} (${username})`);

    if (roomCode) {
      io.to(roomCode).emit('user-left', { username, id: socket.id });
    }

    delete users[socket.id];
  });
}

module.exports = { registerSocketHandlers };
