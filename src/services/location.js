const { insertLocationPing, checkGeofences } = require('../db/queries');
const redisClient = require('../redis');

// ── Geofence enter/exit state ────────────────────────────────────────────────
// Redis is the shared store — correct across multiple instances. When Redis is
// unavailable (or we're deliberately running single-instance on a free tier) we
// fall back to an in-memory Map, which is correct for one process.
//
// We MUST gate on redisClient.status: with enableOfflineQueue, a command issued
// while Redis is down queues forever and its promise never settles — that would
// hang the geofence check.
const memoryState = new Map(); // key -> '1' (inside) | '0' (outside)

function redisReady() {
  return redisClient.status === 'ready';
}

async function getFenceState(key) {
  if (redisReady()) {
    try {
      return await redisClient.get(key);
    } catch {
      /* fall through to memory */
    }
  }
  return memoryState.has(key) ? memoryState.get(key) : null;
}

async function setFenceState(key, value) {
  memoryState.set(key, value);
  if (redisReady()) {
    try {
      await redisClient.setex(key, 7200, value); // 2h TTL — clears stale sessions
    } catch {
      /* memory copy already updated */
    }
  }
}

function isValidCoord(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Single code path for EVERY location ping — whether it arrived over the socket
// (app in foreground) or over REST (background task, screen locked). Keeps
// persistence, geofencing, and broadcasting identical for both.
function processLocationPing(io, { userId, username, roomCode, lat, lng }) {
  // Persist fire-and-forget — must never block the broadcast.
  insertLocationPing(userId, lat, lng, roomCode).catch((err) => {
    console.error('insertLocationPing failed:', { userId, err: err.message });
  });

  // Geofence check — also fire-and-forget. One PostGIS query returns every zone
  // in the room with an is_within flag; we only alert on state transitions.
  checkGeofences(roomCode, lat, lng)
    .then(async (fences) => {
      for (const fence of fences) {
        const key = `gf:${roomCode}:${userId}:${fence.id}`;
        const prev = await getFenceState(key);
        const now = fence.is_within ? '1' : '0';

        if (prev === null) {
          // First time we've seen this user against this zone. Record the state.
          // Only alert if they're already inside — a user who has simply never
          // been in the zone must NOT get a spurious "left the zone" alert.
          await setFenceState(key, now);
          if (now === '1') {
            emitAlert(io, roomCode, fence, username, 'enter');
          }
          continue;
        }

        if (prev !== now) {
          emitAlert(io, roomCode, fence, username, now === '1' ? 'enter' : 'exit');
          await setFenceState(key, now);
        }
      }
    })
    .catch((err) => console.error('geofence check failed:', err.message));

  // Broadcast keyed by userId (not socket.id) so a foreground socket ping and a
  // background REST ping from the same person update the SAME marker.
  io.to(roomCode).emit('receive-location', { userId, username, lat, lng });
}

function emitAlert(io, roomCode, fence, username, type) {
  io.to(roomCode).emit('geofence-alert', {
    geofenceId: fence.id,
    username,
    zoneName: fence.name,
    type,
    timestamp: new Date().toISOString(),
  });
}

module.exports = { processLocationPing, isValidCoord };
