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
// it never blocks the real-time broadcast.
async function insertLocationPing(userId, lat, lng) {
  const query = `
    INSERT INTO location_pings (user_id, geom, timestamp)
    VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326), NOW())
  `;
  // PostGIS ST_MakePoint(longitude, latitude) — note: lng before lat.
  //                                $3 = lng, $2 = lat
  await pool.query(query, [userId, lat, lng]);
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

module.exports = { createUser, getUserByUsername, insertLocationPing, getRouteHistory };
