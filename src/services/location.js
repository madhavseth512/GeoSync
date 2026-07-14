const { insertLocationPing, checkGeofences } = require('../db/queries');
const redisClient = require('../redis');

// ── Geofence enter/exit state ────────────────────────────────────────────────
// Redis is the shared store — correct across multiple instances. When Redis is
// unavailable (or we deliberately run single-instance on a free tier) we fall
// back to an in-memory Map, which is correct for one process.
//
// Stored as ONE HASH PER USER PER ROOM: key `gf:<room>:<user>`, fields = fenceId,
// values '1' (inside) / '0' (outside). This is deliberate: a naive design does one
// GET per fence per ping, so N fences => N commands on EVERY location update. With
// a hash it's a single HGETALL regardless of how many zones exist — the difference
// between blowing a free Redis tier in an hour and staying comfortably inside it.
//
// We MUST gate on redisClient.status: with enableOfflineQueue, a command issued
// while Redis is down queues forever and its promise never settles — that would
// hang the geofence check.
const STATE_TTL_S = 7200; // 2h — clears stale sessions
const memoryState = new Map(); // `gf:<room>:<user>` -> { [fenceId]: '1' | '0' }

function redisReady() {
  return redisClient.status === 'ready';
}

// One command returns every zone state for this user.
async function getFenceStates(key) {
  if (redisReady()) {
    try {
      return (await redisClient.hgetall(key)) || {};
    } catch {
      /* fall through to memory */
    }
  }
  return memoryState.get(key) || {};
}

// Only written on an actual enter/exit transition — rare, so the write volume is
// negligible compared to reads.
async function setFenceState(key, fenceId, value) {
  const mem = memoryState.get(key) || {};
  mem[String(fenceId)] = value;
  memoryState.set(key, mem);

  if (redisReady()) {
    try {
      await redisClient.hset(key, String(fenceId), value);
      await redisClient.expire(key, STATE_TTL_S);
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
      if (fences.length === 0) return;

      // ONE read for all zones (see the hash rationale above).
      const stateKey = `gf:${roomCode}:${userId}`;
      const states = await getFenceStates(stateKey);

      for (const fence of fences) {
        const field = String(fence.id);
        const prev = Object.prototype.hasOwnProperty.call(states, field) ? states[field] : null;
        const now = fence.is_within ? '1' : '0';

        if (prev === null) {
          // First time we've seen this user against this zone. Record the state.
          // Only alert if they're already inside — someone who has simply never
          // been in the zone must NOT get a spurious "left the zone" alert.
          await setFenceState(stateKey, fence.id, now);
          if (now === '1') emitAlert(io, roomCode, fence, username, 'enter');
          continue;
        }

        if (prev !== now) {
          emitAlert(io, roomCode, fence, username, now === '1' ? 'enter' : 'exit');
          await setFenceState(stateKey, fence.id, now);
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
