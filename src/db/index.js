const { Pool } = require('pg');

// Single connection pool shared across all query functions.
// Using a pool (not single client) so concurrent requests reuse connections
// rather than opening a new TCP connection per query.
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      parseInt(process.env.DB_MAX_CONNECTIONS) || 10,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

module.exports = pool;
