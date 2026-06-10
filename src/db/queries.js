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

module.exports = { createUser, getUserByUsername };
