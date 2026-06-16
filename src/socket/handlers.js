const { checkThrottle, clearThrottle } = require('./middleware');
const { insertLocationPing } = require('../db/queries');

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

  socket.on('send-location', ({ lat, lng }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    // Validate coordinate ranges — invalid values dropped silently.
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    // Throttle check — drops the event and disconnects repeat offenders.
    if (!checkThrottle(socket)) return;

    users[socket.id] = { ...users[socket.id], lat, lng };

    // Persist the ping fire-and-forget — must NOT block the broadcast. We catch
    // and log errors so a DB hiccup never disrupts real-time location flow.
    insertLocationPing(userId, lat, lng).catch((err) => {
      console.error('insertLocationPing failed:', { userId, lat, lng, err: err.message });
    });

    // userId is included so clients can request this user's route history.
    io.to(roomCode).emit('receive-location', { id: socket.id, userId, lat, lng, username });
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
