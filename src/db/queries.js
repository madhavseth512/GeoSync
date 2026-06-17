const pool = require('./index');

// All SQL strings live here — no raw SQL anywhere else in the codebase.
// Parameterised queries only — never string interpolation (SQL injection).

async function createUser(username, passwordHash) {
  const query = `
    INSERT INTO users (username, password_hash)
    VALUES ($1, $2)
    RETURNING id, username, created_at
  `;
  const result = await pool.query(query, [username, passwordHash]);
  return result.rows[0];
}

async function getUserByUsername(username) {
  const query = `
    SELECT id, username, password_hash
    FROM users
    WHERE username = $1
  `;
  const result = await pool.query(query, [username]);
  return result.rows[0];
}

// Insert a single GPS ping. Called fire-and-forget from the socket handler so
// it never blocks the real-time broadcast. room_code tags the ping for
// room-scoped queries (heatmap).
async function insertLocationPing(userId, lat, lng, roomCode) {
  const query = `
    INSERT INTO location_pings (user_id, room_code, geom, timestamp)
    VALUES ($1, $4, ST_SetSRID(ST_MakePoint($3, $2), 4326), NOW())
  `;
  // PostGIS ST_MakePoint(longitude, latitude) — note: lng before lat.
  //                                $3 = lng, $2 = lat, $4 = roomCode
  await pool.query(query, [userId, lat, lng, roomCode]);
}

// Build a GeoJSON LineString from a user's pings in a time range, ordered by
// time. ST_MakeLine aggregates the points into a path; returns null if fewer
// than 2 points exist (a line needs at least two).
async function getRouteHistory(userId, from, to) {
  const query = `
    SELECT ST_AsGeoJSON(ST_MakeLine(geom ORDER BY timestamp)) AS line
    FROM location_pings
    WHERE user_id = $1
      AND timestamp BETWEEN $2 AND $3
  `;
  const result = await pool.query(query, [userId, from, to]);
  const line = result.rows[0] && result.rows[0].line;
  return line ? JSON.parse(line) : null;
}

// Aggregate a room's pings into a density grid for the heatmap. Rounding coords
// to 3 decimals (~110m cells) and COUNT-ing per cell collapses thousands of raw
// pings into a handful of weighted points — that aggregation IS the heatmap, and
// it keeps the payload small. ST_Y = latitude, ST_X = longitude.
async function getHeatmapData(roomCode, from, to) {
  const query = `
    SELECT ROUND(ST_Y(geom)::numeric, 3) AS lat,
           ROUND(ST_X(geom)::numeric, 3) AS lng,
           COUNT(*)                       AS weight
    FROM location_pings
    WHERE room_code = $1
      AND timestamp BETWEEN $2 AND $3
    GROUP BY lat, lng
  `;
  const result = await pool.query(query, [roomCode, from, to]);
  // Numerics come back as strings from pg — coerce to numbers for the client.
  return result.rows.map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lng),
    weight: Number(r.weight),
  }));
}

// ── Geofence queries ──────────────────────────────────────────────────────────

// Persist a drawn polygon zone. polygon must be a valid GeoJSON Polygon object.
async function saveGeofence(roomCode, name, polygon, userId) {
  const query = `
    INSERT INTO geofences (room_code, name, geom, created_by)
    VALUES ($1, $2, ST_GeomFromGeoJSON($3), $4)
    RETURNING id, name, created_at
  `;
  const result = await pool.query(query, [roomCode, name, JSON.stringify(polygon), userId]);
  return result.rows[0];
}

// Fetch all zones for a room, returning geometry as GeoJSON for the client to render.
async function getGeofencesForRoom(roomCode) {
  const query = `
    SELECT id, name, ST_AsGeoJSON(geom)::json AS geometry, created_at
    FROM geofences
    WHERE room_code = $1
    ORDER BY created_at ASC
  `;
  const result = await pool.query(query, [roomCode]);
  return result.rows;
}

// Delete a zone. roomCode guard prevents one room from deleting another room's zones.
async function deleteGeofence(id, roomCode) {
  const query = `DELETE FROM geofences WHERE id = $1 AND room_code = $2`;
  await pool.query(query, [id, roomCode]);
}

// Single-query geofence check — returns every zone in the room with a boolean
// indicating whether the given point (lat/lng) falls inside it.
// PostGIS ST_MakePoint(lng, lat) — longitude first, then latitude.
// One DB round-trip covers all zones; GIST index makes each ST_Within O(log n).
async function checkGeofences(roomCode, lat, lng) {
  const query = `
    SELECT id, name,
           ST_Within(ST_SetSRID(ST_MakePoint($3, $2), 4326), geom) AS is_within
    FROM geofences
    WHERE room_code = $1
  `;
  const result = await pool.query(query, [roomCode, lat, lng]);
  return result.rows;
}

module.exports = {
  createUser,
  getUserByUsername,
  insertLocationPing,
  getRouteHistory,
  getHeatmapData,
  saveGeofence,
  getGeofencesForRoom,
  deleteGeofence,
  checkGeofences,
};
