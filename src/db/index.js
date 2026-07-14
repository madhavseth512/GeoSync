const { Pool } = require('pg');

// Single connection pool shared across all query functions.
// Using a pool (not a single client) so concurrent requests reuse connections
// rather than opening a new TCP connection per query.
//
// Two connection modes:
//   - Cloud (Neon/Render/etc): a single DATABASE_URL, and TLS is mandatory.
//   - Local dev: discrete host/port/user/password vars, no TLS.
// DATABASE_URL wins when present — that's how the deployed service is configured.
const max = parseInt(process.env.DB_MAX_CONNECTIONS) || 10;

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // Managed Postgres terminates TLS at a proxy whose certificate we don't
        // pin, so we don't verify the chain. The connection is still encrypted.
        ssl: { rejectUnauthorized: false },
        max,
      }
    : {
        host:     process.env.DB_HOST,
        port:     process.env.DB_PORT,
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        max,
      }
);

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

module.exports = pool;
