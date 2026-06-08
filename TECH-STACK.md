# TECH-STACK.md — GeoSync Technology Choices

> Every library in this project was chosen for a specific reason. This file documents what each one does, why it was picked over alternatives, and where to find its documentation. Read this before adding any new dependency.

---

## Runtime & Server

### Node.js
- **What:** JavaScript runtime built on Chrome's V8 engine. Runs JavaScript outside the browser.
- **Why:** Non-blocking, event-driven I/O model is ideal for a high-concurrency real-time app where thousands of sockets are open simultaneously. A single Node process can handle many concurrent connections without thread overhead.
- **Version:** LTS (20.x or higher)
- **Docs:** https://nodejs.org/en/docs

### Express.js
- **What:** Minimal, unopinionated HTTP framework for Node.js.
- **Why:** Provides routing, middleware, and static file serving with minimal boilerplate. GeoSync's HTTP surface (auth endpoints, REST API, static files) is straightforward enough that Express is sufficient — no need for a heavier framework like Nest.js.
- **Version:** 4.x
- **Install:** `npm install express`
- **Docs:** https://expressjs.com/en/4x/api.html

---

## Real-Time Communication

### Socket.IO
- **What:** Real-time bidirectional event-based communication library. Runs on both server (Node.js) and client (browser).
- **Why:** Abstracts over raw WebSockets with automatic fallback to HTTP long-polling if WebSockets are unavailable (e.g. some corporate proxies block WebSocket upgrades). Provides built-in rooms, namespaces, reconnection handling, and a clean `emit`/`on` event API. Building this from scratch on raw WebSockets would require reimplementing all of these.
- **Alternative considered:** Raw WebSocket (`ws` package) — rejected because it lacks rooms, reconnection, and fallback transport.
- **Version:** 4.x
- **Install:** `npm install socket.io`
- **Docs:** https://socket.io/docs/v4/

### @socket.io/redis-adapter
- **What:** Socket.IO adapter that uses Redis Pub/Sub to synchronise socket state across multiple Node.js processes.
- **Why:** Without this, running two Node instances means they have separate in-memory state — a socket on instance 1 cannot receive broadcasts emitted on instance 2. This adapter makes Socket.IO stateless by routing all broadcasts through Redis.
- **Install:** `npm install @socket.io/redis-adapter`
- **Docs:** https://socket.io/docs/v4/redis-adapter/

### ioredis
- **What:** Full-featured Redis client for Node.js.
- **Why:** More robust than the official `redis` package — better TypeScript support, built-in reconnection, and Cluster/Sentinel support for future scaling. Used to create pub/sub clients for the Socket.IO Redis adapter and for direct Redis operations (geofence state, throttle counters).
- **Alternative considered:** `redis` (official package) — either works; `ioredis` chosen for stability and reconnection handling.
- **Install:** `npm install ioredis`
- **Docs:** https://github.com/redis/ioredis

---

## Authentication & Security

### jsonwebtoken
- **What:** JSON Web Token implementation for Node.js — signs and verifies JWTs.
- **Why:** Stateless authentication — the server does not need to store session data. The JWT contains the user's ID and username, signed with a secret key. Any server instance can verify a JWT without consulting a database or shared session store.
- **Install:** `npm install jsonwebtoken`
- **Docs:** https://github.com/auth0/node-jsonwebtoken

### bcrypt
- **What:** Password hashing library using the bcrypt algorithm.
- **Why:** bcrypt is specifically designed for password hashing — it is intentionally slow (configurable work factor) to make brute-force attacks impractical. Unlike SHA-256 or MD5, bcrypt automatically generates and incorporates a salt, preventing rainbow table attacks.
- **Salt rounds used:** 12 (2^12 = 4096 iterations — safe as of 2024)
- **Install:** `npm install bcrypt`
- **Docs:** https://github.com/kelektiv/node.bcrypt.js

### express-validator
- **What:** Middleware for validating and sanitising Express request inputs.
- **Why:** All user inputs (usernames, passwords, coordinates, room codes) must be validated before reaching business logic or the database. express-validator provides a clean declarative API for input validation and returns structured error responses.
- **Install:** `npm install express-validator`
- **Docs:** https://express-validator.github.io/docs/

### express-rate-limit
- **What:** Basic rate-limiting middleware for Express.
- **Why:** Prevents brute-force attacks on the login endpoint and general API abuse. Implements a sliding window counter — if a client exceeds the configured request limit within the time window, subsequent requests receive a 429 response.
- **Install:** `npm install express-rate-limit`
- **Docs:** https://github.com/express-rate-limit/express-rate-limit

### helmet
- **What:** Express middleware that sets secure HTTP response headers.
- **Why:** Protects against common web vulnerabilities by setting headers like `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and `Strict-Transport-Security`. One line of code, significant security improvement.
- **Install:** `npm install helmet`
- **Docs:** https://helmetjs.github.io/

---

## Database

### PostgreSQL (with PostGIS extension)
- **What:** Open-source relational database. PostGIS is an extension that adds spatial data types, spatial functions, and spatial indexing.
- **Why PostgreSQL over MongoDB:** Location data has a clear relational structure (users have many pings, rooms have many geofences) and benefits from JOIN queries and ACID transactions. PostGIS provides spatial operations (ST_Within, ST_Distance, ST_AsGeoJSON) that would require hundreds of lines of manual math in a non-spatial database.
- **Why PostGIS over storing lat/lng as floats:** Spatial indexes (GIST) make containment queries (is this point inside this polygon?) orders of magnitude faster. ST_Within runs a proper computational geometry check — floating point comparison cannot handle this correctly at all polygon shapes.
- **Docker image:** `postgis/postgis:16-3.4` (official PostGIS image)
- **Docs:** https://www.postgresql.org/docs/ and https://postgis.net/documentation/

### pg (node-postgres)
- **What:** PostgreSQL client for Node.js.
- **Why:** The standard, most widely-used PostgreSQL client for Node. Uses a connection pool (`Pool`) for efficient connection management — connections are reused rather than opened/closed per query.
- **Install:** `npm install pg`
- **Docs:** https://node-postgres.com/

---

## Frontend & Mapping

### Leaflet.js
- **What:** Open-source JavaScript library for interactive maps.
- **Why over Google Maps API:** No API key required, no usage limits, no cost. Leaflet is lighter (42KB vs 300KB+ for Google Maps), fully open-source, and pairs perfectly with OpenStreetMap tiles. The API is clean and well-documented.
- **Why over Mapbox:** Same reasons — no token required, no account needed.
- **Version:** 1.9.4
- **CDN:** `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- **Docs:** https://leafletjs.com/reference.html

### Leaflet.draw
- **What:** Leaflet plugin that adds drawing tools to the map — polygons, rectangles, circles, polylines.
- **Why:** Geofencing requires users to draw arbitrary polygon zones on the map. Leaflet.draw provides a complete drawing toolbar and event system (`draw:created`) that integrates directly with Leaflet's layer model.
- **CDN:** `https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js`
- **Docs:** https://leaflet.github.io/Leaflet.draw/docs/leaflet-draw-latest.html

### Leaflet.heat
- **What:** Leaflet plugin for rendering heatmap layers from point data.
- **Why:** Accepts an array of `[lat, lng, intensity]` tuples and renders a smooth gradient density layer with one function call. Lightweight (3KB) and GPU-accelerated via HTML5 Canvas.
- **CDN:** `https://leaflet.github.io/Leaflet.heat/dist/leaflet-heat.js`
- **Docs:** https://github.com/Leaflet/Leaflet.heat

### OpenStreetMap
- **What:** Free, community-maintained map tile provider.
- **Why:** Completely free with no API key, no rate limits for reasonable use, and global coverage. The standard choice for open-source mapping applications.
- **Tile URL:** `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **Docs:** https://wiki.openstreetmap.org/wiki/Tiles

---

## Infrastructure & DevOps

### Redis
- **What:** In-memory data structure store used as a message broker (Pub/Sub) and cache.
- **Why:** Socket.IO's Redis adapter uses Redis Pub/Sub to synchronise broadcast events across Node instances. Redis is also used directly for ephemeral state: geofence entry/exit status per user, throttle violation counters, and short-lived caches.
- **Docker image:** `redis:7-alpine` (lightweight official image)
- **Docs:** https://redis.io/docs/

### Docker & Docker Compose
- **What:** Docker containerises applications and their dependencies. Docker Compose defines and runs multi-container applications.
- **Why:** Reproducible environment — the app runs identically on any machine. Docker Compose orchestrates all four services (Node, Postgres, Redis, Nginx) with a single command. Eliminates "works on my machine" issues during deployment.
- **Docs:** https://docs.docker.com/compose/

### Nginx
- **What:** High-performance HTTP server and reverse proxy.
- **Why:** Sits in front of the Node.js server to handle SSL termination, compression, and request routing. Critical for WebSocket support — Nginx must be configured with `Upgrade` and `Connection` headers to correctly proxy WebSocket connections, otherwise Socket.IO falls back to long-polling.
- **Docker image:** `nginx:alpine`
- **Docs:** https://nginx.org/en/docs/

---

## Development Tools

### nodemon
- **What:** Utility that monitors Node.js files and automatically restarts the server on file changes.
- **Why:** Essential for development workflow — without it, every code change requires manually stopping and restarting the server.
- **Install:** `npm install --save-dev nodemon`
- **Usage:** `"dev": "nodemon server.js"` in `package.json` scripts
- **Docs:** https://nodemon.io/

### uuid
- **What:** Generates RFC 4122-compliant universally unique identifiers.
- **Why:** Used to generate unique room codes. `uuidv4().slice(0, 6).toUpperCase()` produces a 6-character alphanumeric room code that is short enough to type but unique enough for practical use.
- **Install:** `npm install uuid`
- **Docs:** https://github.com/uuidjs/uuid

---

## Dependency Summary

```
Production dependencies:
  express                    HTTP server and routing
  socket.io                  Real-time WebSocket communication
  @socket.io/redis-adapter   Multi-instance socket state sync
  ioredis                    Redis client
  jsonwebtoken               JWT signing and verification
  bcrypt                     Password hashing
  express-validator          Input validation
  express-rate-limit         HTTP rate limiting
  helmet                     Security headers
  pg                         PostgreSQL client
  uuid                       Room code generation

Development dependencies:
  nodemon                    Auto-restart on file change
```
