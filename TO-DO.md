# TO-DO.md — GeoSync Development Checklist

> Update this file as tasks are completed. Mark done items with [x].
> Never start a new phase until every task in the current phase is checked off and the exit condition is verified.

---

## Current Status

**Active Phase:** Phase 3 (Phases 1–2 complete)
**Last Updated:** 2026-06-09

---

## Phase 1 — Project Skeleton & Basic Map

**Goal:** Express server running, Leaflet map renders in browser. No real-time yet.

### Tasks
- [x] Initialise project with `npm init -y`
- [x] Install dependencies: `express`
- [x] Create folder structure: `public/`, `src/`, `docs/`
- [x] Write `server.js` — Express app, static file serving from `/public`, listen on port 3000
- [x] Write `public/index.html` — HTML shell with Leaflet CSS/JS via CDN, viewport meta tag
- [x] Write `public/style.css` — full-screen map (`#map` fills viewport, no margin/padding on body)
- [x] Write `public/app.js` — initialise Leaflet map centred on `[20.5937, 78.9629]` (India), zoom 5
- [x] Add OpenStreetMap tile layer to map
- [x] Add `nodemon` as dev dependency, add `"dev": "nodemon server.js"` script to `package.json`
- [x] Verify server starts without errors
- [x] Verify map renders correctly at `localhost:3000`
- [x] Add `.gitignore` — ignore `node_modules/`, `.env`

### Exit Condition
`localhost:3000` shows a full-screen interactive Leaflet map of India. No console errors. Server restarts automatically on file save.

---

## Phase 2 — Real-Time Location Sharing via Socket.IO

**Goal:** GPS coordinates flow from browser → server → all connected browsers in real time. Core feature complete.

### Tasks
- [x] Install dependencies: `socket.io`
- [x] Add Socket.IO server to `server.js` — wrap HTTP server, initialise `io`
- [x] Create `users` object in `server.js` — stores `socket.id → { lat, lng }`
- [x] Add `io.on('connection')` handler in `server.js`
- [x] Handle `send-location` event — store in `users`, broadcast `receive-location` to all clients with `{ id, lat, lng }`
- [x] Handle `disconnect` event — delete from `users`, broadcast `user-disconnected` with `socket.id`
- [x] Log connect and disconnect events to console with socket ID
- [x] Add Socket.IO client script tag to `index.html` (`/socket.io/socket.io.js`)
- [x] Write GPS reading in `app.js` — `navigator.geolocation.watchPosition()` with 5-second interval
- [x] Configure `watchPosition` options — `enableHighAccuracy: true`, `timeout: 5000`, `maximumAge: 0`
- [x] Handle geolocation permission denied error — show alert to user (toast per conventions, not alert())
- [x] Emit `send-location` with `{ lat, lng }` on each GPS update
- [x] Handle `receive-location` in `app.js` — create marker if new socket ID, update position if existing
- [x] Handle `user-disconnected` in `app.js` — remove marker from map, delete from local markers object
- [x] Auto-center map on own location on first GPS fix
- [x] Add username popup to each marker showing socket ID (temporary — replaced with real username in Phase 3)
- [x] Add connected users count display somewhere on the page
- [x] Test with two browser tabs simultaneously — both show each other's markers

### Exit Condition
Two browser tabs open. Moving (or simulating movement by editing coordinates in DevTools) causes the marker on the other tab to update within 5 seconds. Closing one tab removes its marker from the other tab within seconds. No memory leaks — `users` object does not retain disconnected entries.

---

## Phase 3 — JWT Authentication & Private Rooms

**Goal:** Users register and log in. Location sharing is scoped to private rooms only.

### Tasks
- [ ] Install dependencies: `bcrypt`, `jsonwebtoken`, `express-validator`, `uuid`
- [ ] Create `src/db/index.js` — PostgreSQL connection pool using `pg`
- [ ] Create `src/db/queries.js` — named async functions for all DB operations (no raw SQL in routes)
- [ ] Create `init.sql` — `users` table schema (id, username, password_hash, created_at)
- [ ] Run `init.sql` against local PostgreSQL instance
- [ ] Create `src/routes/auth.js` — `POST /api/register` with input validation, bcrypt hashing, DB insert
- [ ] Create `src/routes/auth.js` — `POST /api/login` with bcrypt compare, JWT signing, token return
- [ ] Create `src/middleware/auth.js` — `verifyToken` middleware that reads `Authorization: Bearer <token>` header
- [ ] Mount auth routes in `server.js` — `app.use('/api', authRouter)`
- [ ] Create Socket.IO auth middleware in `src/socket/middleware.js` — `io.use()` that verifies JWT, attaches decoded user to `socket.data.user`
- [ ] Reject unauthenticated socket connections with error message
- [ ] Add room join logic — `socket.on('join-room', { roomCode })` — `socket.join(roomCode)`, store `socket.data.roomCode`
- [ ] Replace `io.emit()` with `io.to(roomCode).emit()` in all broadcast calls
- [ ] Generate random 6-character room codes using `uuid` (first 6 chars)
- [ ] Update `users` object to store `{ lat, lng, username, roomCode }` per socket
- [ ] Build login UI in `index.html` — username/password form shown before map
- [ ] Build room UI — "Create Room" button (generates code) and "Join Room" input
- [ ] Display generated room code prominently so it can be shared
- [ ] Store JWT in `localStorage` on login, read it on page load (skip login if token exists and valid)
- [ ] Update marker popups to show real username instead of socket ID
- [ ] Build sidebar showing connected users list with usernames for the current room
- [ ] Emit `user-joined` and `user-left` events with username to room members

### Exit Condition
User A registers, logs in, creates a room, shares the code with User B. User B logs in and joins with the code. Both see each other on the map. User C in a different room sees nobody. Refreshing the page re-uses the stored JWT and skips the login screen.

---

## Phase 4 — Rate Limiting & Security Hardening

**Goal:** Server is hardened against abuse and basic attacks before any public exposure.

### Tasks
- [ ] Install dependencies: `express-rate-limit`, `helmet`
- [ ] Add `helmet()` middleware to Express — secure HTTP headers
- [ ] Configure CORS in Express — allow only specific origin, not wildcard
- [ ] Create `src/middleware/rateLimiter.js` — auth limiter: max 20 requests per 15 minutes on `/api/login` and `/api/register`
- [ ] Apply auth rate limiter to auth routes
- [ ] Create general API limiter — max 100 requests per 15 minutes on all `/api/*` routes
- [ ] Add input validation to `POST /api/register` — username: 3–50 chars, alphanumeric + underscore; password: min 8 chars
- [ ] Add input validation to `POST /api/login` — both fields required, non-empty
- [ ] Create Socket.IO throttle middleware in `src/socket/middleware.js`:
  - Track last emit timestamp per socket in a Map
  - If `send-location` arrives less than 4 seconds after last event, drop silently and increment violation counter
  - If violation counter exceeds 10, disconnect socket with reason `'throttle_exceeded'`
  - Reset violation counter on clean interval
- [ ] Validate `lat` and `lng` values in `send-location` handler — must be valid numbers, lat in [-90, 90], lng in [-180, 180]
- [ ] Add try/catch to all route handlers — uncaught errors return 500 with generic message, full error logged to console
- [ ] Test rate limiting — rapid POST to `/api/login` should return 429 after 20 attempts
- [ ] Test socket throttling — spamming `send-location` should disconnect socket after violations

### Exit Condition
Sending 25 rapid POST requests to `/api/login` results in 429 responses after the 20th. Writing a script to emit `send-location` 20 times per second results in the socket being disconnected within 10 seconds. Server does not crash on any of these tests.

---

## Phase 5 — Redis Pub/Sub for Horizontal Scaling

**Goal:** Multiple Node instances share socket state via Redis. Architecture is now horizontally scalable.

### Tasks
- [ ] Install dependencies: `@socket.io/redis-adapter`, `ioredis`
- [ ] Add Redis connection to `server.js` — create pub and sub clients using `ioredis`
- [ ] Apply Redis adapter — `io.adapter(createAdapter(pubClient, subClient))`
- [ ] Add Redis connection error handling — log errors, do not crash server
- [ ] Update `docker-compose.yml` to include Redis service
- [ ] Add `REDIS_URL` to `.env` and `.env.example`
- [ ] Add Redis-based geofence state storage in `src/socket/handlers.js`:
  - `SET geofence:state:{socketId}:{zoneId} inside/outside EX 3600`
  - `GET geofence:state:{socketId}:{zoneId}` before each geofence check
- [ ] Add Redis-based session cache for user data (optional but recommended)
- [ ] Test with two Node instances:
  - Run `PORT=3000 node server.js` and `PORT=3001 node server.js` simultaneously
  - Connect Browser A to port 3000, Browser B to port 3001
  - Verify Browser A sees Browser B's location updates (routed through Redis)
- [ ] Document the test result as a comment in `server.js`

### Exit Condition
Two Node processes running simultaneously on different ports. A browser on each port can see the other's location updates in real time. Stopping one Node process does not crash the other. Redis connection failure is logged but does not crash the server.

---

## Phase 6 — PostgreSQL + PostGIS Route History

**Goal:** All location data is persisted. Historical routes can be queried and visualised.

### Tasks
- [ ] Install dependencies: `pg` (if not already installed)
- [ ] Update `init.sql` — add `location_pings` table with PostGIS geometry column
- [ ] Add spatial index on `location_pings.geom` (GIST)
- [ ] Add time-based index on `(user_id, timestamp DESC)`
- [ ] Add non-blocking location ping insert to `send-location` handler — `INSERT INTO location_pings` fires async without awaiting in the socket handler
- [ ] Create `src/db/queries.js` function: `insertLocationPing(userId, lat, lng)`
- [ ] Create `src/db/queries.js` function: `getRouteHistory(userId, from, to)` — returns GeoJSON LineString
- [ ] Create `src/routes/history.js` — `GET /api/history/:userId?from=&to=`
- [ ] Validate `from` and `to` as valid ISO timestamps, default to last 30 minutes if not provided
- [ ] Mount history routes in `server.js`
- [ ] Add route replay to client — clicking username in sidebar sends request to `/api/history`
- [ ] Render returned GeoJSON LineString as a polyline on the map with `L.geoJSON()`
- [ ] Style the polyline — dashed, colour matching the user's marker colour
- [ ] Add "Clear Route" button to remove the polyline from the map
- [ ] Test: move around (or simulate), request history, verify polyline renders correctly

### Exit Condition
After 5 minutes of simulated movement, clicking a username in the sidebar renders a visible polyline on the map showing their path. The `/api/history` endpoint returns valid GeoJSON. The `location_pings` table is growing with new rows on every GPS update.

---

## Phase 7 — Geofencing with Real-Time Alerts

**Goal:** Users draw polygon zones. Real-time enter/exit alerts fire for all room members.

### Tasks
- [ ] Install client dependency: Leaflet.draw plugin (via CDN)
- [ ] Install server dependency: (none — PostGIS handles spatial queries)
- [ ] Update `init.sql` — add `geofences` table with PostGIS polygon geometry column
- [ ] Add spatial index on `geofences.geom`
- [ ] Create `src/db/queries.js` function: `saveGeofence(roomId, name, polygonGeoJSON, userId)`
- [ ] Create `src/db/queries.js` function: `getGeofencesForRoom(roomId)` — returns array of zones
- [ ] Create `src/routes/geofences.js` — `POST /api/geofences` (save new zone), `GET /api/geofences/:roomId` (load all zones)
- [ ] Mount geofence routes in `server.js`
- [ ] Add Leaflet.draw toolbar to client map — allow polygon and rectangle drawing
- [ ] On draw complete, prompt user for zone name, POST to `/api/geofences`
- [ ] On room join, load existing geofences from `GET /api/geofences/:roomId` and render on map
- [ ] Add geofence check to `send-location` socket handler:
  - Query active geofences for room from DB (cache result in Redis for 60 seconds)
  - Run `ST_Within(userPoint, zoneGeom)` for each zone via PostGIS
  - Compare to Redis state — detect enter/exit transitions
  - Update Redis state
  - Emit `geofence-alert` event on transition
- [ ] Handle `geofence-alert` on client — show toast notification with username, zone name, enter/exit
- [ ] Add alert history panel to sidebar — last 10 alerts with timestamps
- [ ] Add ability to delete geofences (draw toolbar delete tool + `DELETE /api/geofences/:id`)

### Exit Condition
Draw a polygon on the map. Simulate a coordinate path that enters, moves through, and exits the polygon. Observe toast notifications for enter and exit events on all connected clients in the room. Alerts appear in the sidebar history panel with correct timestamps.

---

## Phase 8 — Visit Density Heatmap

**Goal:** Historical location data visualised as a density heatmap with time range selection.

### Tasks
- [ ] Add Leaflet.heat plugin to `index.html` via CDN
- [ ] Create `src/db/queries.js` function: `getHeatmapData(roomId, from, to)` — rounded coordinates with frequency count
- [ ] Create `src/routes/heatmap.js` — `GET /api/heatmap/:roomId?from=&to=`
- [ ] Validate and default time range parameters (default: last 6 hours)
- [ ] Mount heatmap routes in `server.js`
- [ ] Add mode toggle button to UI — "Live" and "Heatmap" modes
- [ ] In Live mode: show real-time markers, hide heatmap layer
- [ ] In Heatmap mode: hide live markers, show heatmap layer using `L.heatLayer()`
- [ ] Add time range selector — dropdown with options: Last 1 hour, Last 6 hours, Last 24 hours
- [ ] Fetch heatmap data on mode switch and on time range change
- [ ] Auto-refresh heatmap data every 60 seconds when in heatmap mode
- [ ] Style heatmap — `radius: 25`, `blur: 15`, `maxZoom: 17`, gradient from blue (sparse) to red (dense)
- [ ] Show loading indicator while heatmap data is fetching

### Exit Condition
After accumulating at least 10 minutes of location history in a room, switching to Heatmap mode shows a visible gradient layer where users have been. Changing the time range updates the heatmap. Live mode and Heatmap mode toggle cleanly without map errors.

---

## Phase 9 — Docker + Cloud Deployment

**Goal:** Full stack containerised and running at a live HTTPS URL.

### Tasks
- [ ] Write `Dockerfile` for Node.js server — multi-stage build, non-root user, expose port 3000
- [ ] Write `docker-compose.yml` — four services: node, postgres (with PostGIS image), redis, nginx
- [ ] Configure `depends_on` with health checks — node waits for postgres and redis to be healthy
- [ ] Write `nginx.conf` — HTTP proxy to Node, WebSocket upgrade headers for `/socket.io/`
- [ ] Write `init.sql` — complete schema including all tables, indexes, and `CREATE EXTENSION postgis`
- [ ] Write `.env.example` — all required variables with placeholder values and comments
- [ ] Add volume for PostgreSQL data persistence — data survives container restarts
- [ ] Test `docker-compose up --build` from scratch — entire stack comes up correctly
- [ ] Verify WebSockets work through Nginx (not just HTTP long-polling)
- [ ] Deploy to Railway or Render — connect GitHub repo, set environment variables
- [ ] Configure HTTPS on deployment platform — valid SSL certificate
- [ ] Test live URL from a real mobile device with actual GPS
- [ ] Write `README.md`:
  - Project description (the interview paragraph)
  - Architecture diagram (ASCII from `ARCHITECTURE.md`)
  - Feature list
  - Local setup instructions
  - Live demo URL
  - Tech stack badges
- [ ] Final test — open live URL on two different phones, share room code, verify real-time location sharing works over mobile GPS

### Exit Condition
`docker-compose up --build` starts all four services without errors. The live HTTPS URL opens on a mobile browser, requests GPS permission, and shows real-time location sharing with another device. The README has a working demo link.

---

## Upgrade Reference

For detailed implementation notes on each upgrade (what it is, what to add, interview talking points), refer to `GeoSync_Upgrade_Reference.md`.
