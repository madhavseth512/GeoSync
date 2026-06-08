# ARCHITECTURE.md — GeoSync System Design

---

## System Overview

GeoSync has three distinct layers:

1. **Client layer** — Browser running Leaflet.js map, Socket.IO client, and vanilla JS
2. **Server layer** — Node.js + Express HTTP server with Socket.IO WebSocket layer on top
3. **Data layer** — PostgreSQL (persistent storage) + Redis (ephemeral shared state)

All three layers are containerised and orchestrated by Docker Compose in production. An Nginx reverse proxy sits in front of the Node server and handles HTTP/WebSocket routing.

---

## High-Level Architecture

```
                        ┌─────────────────────────────────┐
                        │           CLIENTS                │
                        │                                  │
                        │  Browser A        Browser B      │
                        │  Leaflet Map      Leaflet Map     │
                        │  Socket.IO        Socket.IO       │
                        │  Geolocation      Geolocation     │
                        └────────┬──────────────┬──────────┘
                                 │              │
                           WebSocket        WebSocket
                           + HTTP           + HTTP
                                 │              │
                        ┌────────▼──────────────▼──────────┐
                        │             NGINX                 │
                        │    Reverse Proxy + WS Upgrade     │
                        └────────────────┬─────────────────┘
                                         │
                        ┌────────────────▼─────────────────┐
                        │          NODE.JS SERVER           │
                        │                                   │
                        │   Express.js (HTTP routes)        │
                        │   Socket.IO  (WebSocket events)   │
                        │   JWT Middleware                  │
                        │   Rate Limiter                    │
                        └──────────┬──────────┬────────────┘
                                   │          │
                    ┌──────────────▼──┐    ┌──▼──────────────────┐
                    │     REDIS       │    │     POSTGRESQL        │
                    │                 │    │     + POSTGIS         │
                    │  Pub/Sub broker │    │                       │
                    │  Socket adapter │    │  users table          │
                    │  Geofence state │    │  location_pings table │
                    │  Session cache  │    │  geofences table      │
                    └─────────────────┘    └───────────────────────┘
```

---

## Real-Time Data Flow (Core Loop)

This is the most important flow in the system — what happens every 5 seconds per connected user.

```
1. Browser reads GPS
   navigator.geolocation.watchPosition() fires
   → { latitude, longitude, accuracy } from browser

2. Client emits to server
   socket.emit('send-location', { lat, lng })
   → travels over persistent WebSocket connection

3. Server receives and validates
   socket.on('send-location', handler)
   → throttle check: is this socket emitting too fast?
   → validate: are lat/lng valid numbers in range?
   → store in users object: users[socket.id] = { lat, lng, username, roomCode }

4. Server persists to database (async, non-blocking)
   INSERT INTO location_pings (user_id, geom, timestamp)
   VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326), NOW())
   → does NOT block the broadcast — fire and forget with error logging

5. Server checks geofences (async)
   SELECT id, name, geom FROM geofences WHERE room_id = $1
   → ST_Within(userPoint, geofencePolygon) for each active zone
   → compare result to last known state in Redis
   → if transition detected: io.to(roomCode).emit('geofence-alert', alertData)

6. Server broadcasts to room
   io.to(roomCode).emit('receive-location', { id: socket.id, lat, lng, username })
   → Socket.IO sends to all sockets in the room EXCEPT the sender
   → Redis adapter ensures this reaches sockets on other Node instances too

7. All clients in the room receive the update
   socket.on('receive-location', handler)
   → if marker exists for this socket.id: marker.setLatLng([lat, lng])
   → if marker does not exist: create new L.marker(), add to map
   → update username label in sidebar
```

---

## Authentication Flow

```
REGISTER:
Client POST /api/register { username, password }
  → express-validator checks input
  → bcrypt.hash(password, 12)
  → INSERT INTO users (username, password_hash)
  → return 201 { message: 'User created' }

LOGIN:
Client POST /api/login { username, password }
  → SELECT * FROM users WHERE username = $1
  → bcrypt.compare(password, hash)
  → if match: jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '24h' })
  → return 200 { token }
  → client stores token in localStorage

SOCKET CONNECTION:
Client connects: io({ auth: { token } })
  → io.use() middleware intercepts
  → jwt.verify(token, JWT_SECRET)
  → if valid: socket.data.user = decoded payload, call next()
  → if invalid: next(new Error('Authentication error')) — connection refused

ROOM JOIN:
Client emits 'join-room' { roomCode }
  → server validates roomCode format
  → socket.join(roomCode)
  → socket.data.roomCode = roomCode
  → io.to(roomCode).emit('user-joined', { username })
```

---

## Database Schema

```sql
-- Enable PostGIS extension (run once)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table
CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  username     VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Location pings — every GPS update from every user
CREATE TABLE location_pings (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  geom      GEOMETRY(Point, 4326) NOT NULL,   -- SRID 4326 = WGS84 (standard GPS)
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for fast geofence and history queries
CREATE INDEX location_pings_geom_idx ON location_pings USING GIST(geom);
-- Time index for history range queries
CREATE INDEX location_pings_time_idx ON location_pings(user_id, timestamp DESC);

-- Geofences — polygons drawn by users on the map
CREATE TABLE geofences (
  id         SERIAL PRIMARY KEY,
  room_id    VARCHAR(20) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  geom       GEOMETRY(Polygon, 4326) NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for geofence containment queries
CREATE INDEX geofences_geom_idx ON geofences USING GIST(geom);
```

---

## Redis Data Model

Redis stores ephemeral state that must be shared across Node instances but does not need to be persisted across server restarts.

```
Key pattern                          Value              TTL
─────────────────────────────────────────────────────────────
geofence:state:{socketId}:{zoneId}   "inside"/"outside"  1 hour
session:{socketId}                   JSON user object    24 hours
throttle:violations:{socketId}       integer count       1 hour
```

The Socket.IO Redis adapter uses its own internal key patterns — do not manually write to those keys.

---

## Redis Pub/Sub Scaling Model

```
Node Instance 1 (port 3000)          Node Instance 2 (port 3001)
       │                                      │
       │  Client A connected here             │  Client B connected here
       │                                      │
       ▼                                      ▼
  io.to(room).emit()                    receives broadcast
       │                                      ▲
       │  PUBLISH to Redis channel            │
       └──────────────► REDIS ───────────────►│
                     Pub/Sub                SUBSCRIBE
                     broker                picks up
                                           and forwards
                                           to Client B
```

Without Redis adapter: Client A and Client B cannot see each other because they are connected to different Node processes with separate in-memory state.

With Redis adapter: Every `io.to(room).emit()` is automatically published to Redis, and all other Node instances subscribed to that channel forward it to their locally connected clients.

---

## Geofencing Architecture

```
Every location update triggers:

1. Load active geofences for room from PostgreSQL
   (cached in Redis for 60s to avoid DB query on every ping)

2. For each geofence polygon:
   Run PostGIS: SELECT ST_Within(
     ST_SetSRID(ST_MakePoint(lng, lat), 4326),
     geofences.geom
   )

3. Compare to last known state from Redis:
   GET geofence:state:{socketId}:{zoneId}

4. If state changed:
   - Update Redis: SET geofence:state:{socketId}:{zoneId} "inside"/"outside"
   - Emit alert: io.to(roomCode).emit('geofence-alert', {
       username, zoneName, event: 'entered' | 'exited', timestamp
     })

5. If state unchanged: do nothing
```

---

## Docker Compose Service Map

```
docker-compose.yml defines 4 services:

┌─────────────────────────────────────────────────────────┐
│                    docker network: geosync               │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────┐ │
│  │  nginx   │   │  node    │   │      postgres         │ │
│  │          │──►│          │──►│  (with PostGIS)       │ │
│  │ port 80  │   │ port 3000│   │  port 5432            │ │
│  │ port 443 │   │          │   │  volume: pgdata       │ │
│  └──────────┘   └────┬─────┘   └──────────────────────┘ │
│                      │                                   │
│                 ┌────▼─────┐                             │
│                 │  redis   │                             │
│                 │ port 6379│                             │
│                 └──────────┘                             │
└─────────────────────────────────────────────────────────┘

Startup order (depends_on):
  postgres and redis must be healthy before node starts
  node must be running before nginx starts
```

---

## Nginx WebSocket Configuration

WebSocket connections require specific Nginx headers to allow the HTTP → WebSocket upgrade handshake. Without these, Socket.IO falls back to HTTP long-polling.

```nginx
location /socket.io/ {
    proxy_pass         http://node:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;       # Required for WS
    proxy_set_header   Connection "upgrade";         # Required for WS
    proxy_set_header   Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

---

## Heatmap Data Flow

```
Client requests heatmap:
GET /api/heatmap/:roomId?from=2024-01-01&to=2024-01-02

Server queries PostGIS:
SELECT
  ROUND(ST_Y(geom)::numeric, 4) AS lat,   -- Round to ~11m grid
  ROUND(ST_X(geom)::numeric, 4) AS lng,
  COUNT(*) AS intensity
FROM location_pings lp
JOIN users u ON lp.user_id = u.id
WHERE u.room_id = $1
  AND lp.timestamp BETWEEN $2 AND $3
GROUP BY lat, lng
ORDER BY intensity DESC

Returns: [[lat, lng, intensity], [lat, lng, intensity], ...]

Client renders:
L.heatLayer(data, { radius: 25, blur: 15, maxZoom: 17 }).addTo(map)
```
