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
-- room_code tags each ping with the room it was recorded in, so room-scoped
-- features (heatmap) can filter by room. Nullable: pings predating the column.
CREATE TABLE IF NOT EXISTS location_pings (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  room_code VARCHAR(6),
  geom      GEOMETRY(Point, 4326) NOT NULL,   -- SRID 4326 = WGS84 (standard GPS)
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index — makes geometry queries (geofence, history) fast.
CREATE INDEX IF NOT EXISTS location_pings_geom_idx ON location_pings USING GIST(geom);
-- Time index — speeds up history range queries per user.
CREATE INDEX IF NOT EXISTS location_pings_time_idx ON location_pings(user_id, timestamp DESC);
-- Room+time index — speeds up heatmap range queries scoped to a room.
CREATE INDEX IF NOT EXISTS location_pings_room_time_idx ON location_pings(room_code, timestamp DESC);

-- Geofences — polygon zones drawn by users in a room.
-- room_code is VARCHAR (no FK) because rooms are ephemeral and never stored in DB.
CREATE TABLE IF NOT EXISTS geofences (
  id         SERIAL PRIMARY KEY,
  room_code  VARCHAR(6) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  geom       GEOMETRY(Polygon, 4326) NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- room_code index — filters geofences by room without a full table scan.
CREATE INDEX IF NOT EXISTS geofences_room_idx ON geofences(room_code);
-- GIST spatial index — makes ST_Within checks O(log n) instead of O(n).
CREATE INDEX IF NOT EXISTS geofences_geom_idx ON geofences USING GIST(geom);
