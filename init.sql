-- GeoSync database schema — run once against the geosync database.
-- Must be runnable from scratch. CREATE EXTENSION requires a superuser.

-- PostGIS — adds spatial types, functions, and indexing.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table — stores credentials for JWT-based authentication.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Location pings — one row per GPS update from every user.
CREATE TABLE IF NOT EXISTS location_pings (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  geom      GEOMETRY(Point, 4326) NOT NULL,   -- SRID 4326 = WGS84 (standard GPS)
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index — makes geometry queries (geofence, history) fast.
CREATE INDEX IF NOT EXISTS location_pings_geom_idx ON location_pings USING GIST(geom);
-- Time index — speeds up history range queries per user.
CREATE INDEX IF NOT EXISTS location_pings_time_idx ON location_pings(user_id, timestamp DESC);
