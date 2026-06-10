const { checkThrottle, clearThrottle } = require('./middleware');

// All Socket.IO event handlers — io.to(roomCode).emit() everywhere, never io.emit().

function registerSocketHandlers(io, socket, users) {
  const { username } = socket.data.user;

  console.log(`socket connected: ${socket.id} (${username})`);

  socket.on('join-room', ({ roomCode }) => {
    if (!roomCode || typeof roomCode !== 'string') return;

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    users[socket.id] = { username, roomCode };

    io.to(roomCode).emit('user-joined', { username });
    console.log(`${username} joined room ${roomCode}`);
  });

  socket.on('send-location', ({ lat, lng }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    // Validate coordinate ranges — invalid values dropped silently.
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    // Throttle check — drops the event and disconnects repeat offenders.
    if (!checkThrottle(socket)) return;

    users[socket.id] = { ...users[socket.id], lat, lng };

    io.to(roomCode).emit('receive-location', { id: socket.id, lat, lng, username });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    console.log(`socket disconnected: ${socket.id} (${username})`);

    // Always clean up throttle state on disconnect to prevent Map memory leak.
    clearThrottle(socket.id);

    if (roomCode) {
      io.to(roomCode).emit('user-left', { username, id: socket.id });
    }

    delete users[socket.id];
  });
}

module.exports = { registerSocketHandlers };
