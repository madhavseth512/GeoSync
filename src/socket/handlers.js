const { checkThrottle, clearThrottle } = require('./middleware');
const { insertLocationPing, checkGeofences } = require('../db/queries');
const redisClient = require('../redis');

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
    // roomCode is tagged on the ping so the heatmap can scope by room.
    insertLocationPing(userId, lat, lng, roomCode).catch((err) => {
      console.error('insertLocationPing failed:', { userId, lat, lng, err: err.message });
    });

    // Geofence check — also fire-and-forget so it never delays the broadcast.
    // checkGeofences returns every zone in the room with is_within boolean in one
    // PostGIS query. Redis tracks the previous state so we only emit on transitions.
    checkGeofences(roomCode, lat, lng).then(async (fences) => {
      for (const fence of fences) {
        const key = `gf:${roomCode}:${userId}:${fence.id}`;
        const prev = await redisClient.get(key); // "1" = was inside, null = was outside
        const now = fence.is_within ? '1' : '0';

        if (prev !== now) {
          // State changed — enter or exit transition detected.
          const type = fence.is_within ? 'enter' : 'exit';
          io.to(roomCode).emit('geofence-alert', {
            geofenceId: fence.id, // lets the client clear these alerts if the zone is deleted
            username,
            zoneName: fence.name,
            type,
            timestamp: new Date().toISOString(),
          });
          // TTL 2h — auto-clears stale state after a session ends without disconnect.
          await redisClient.setex(key, 7200, now);
        }
      }
    }).catch((err) => {
      console.error('geofence check failed:', err.message);
    });

    // userId is included so clients can request this user's route history.
    io.to(roomCode).emit('receive-location', { id: socket.id, userId, lat, lng, username });
  });

  // A geofence was deleted (DB removal already done via authenticated REST).
  // Relay to the rest of the room so the zone disappears from their maps live.
  // socket.to() excludes the sender, who already removed it locally. Works across
  // instances via the Redis adapter.
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

    if (roomCode) {
      io.to(roomCode).emit('user-left', { username, id: socket.id });
    }

    delete users[socket.id];
  });
}

module.exports = { registerSocketHandlers };
