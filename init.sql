-- GeoSync database schema — run once against the geosync database.
-- Phase 3: users table only. location_pings and geofences added in later phases.

-- Users table — stores credentials for JWT-based authentication.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
