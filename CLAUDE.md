# CLAUDE.md — GeoSync Project Briefing

> Read this file at the start of every session before touching any code.
> This is the single source of truth for what GeoSync is, how it is built, and how you must work on it.

---

## What is GeoSync?

GeoSync is a full-stack real-time multi-user location tracking web application. Users authenticate via JWT-based login, create or join private rooms using a unique room code, and instantly share their live GPS coordinates with everyone in their room — with each user's position rendered as a dynamic marker on an interactive map that updates every five seconds through a persistent WebSocket connection.

The system is horizontally scalable via a Redis Pub/Sub adapter, persists all location data in PostgreSQL with PostGIS, supports geofencing with real-time alerts, provides a heatmap analytics mode, and is fully containerised with Docker Compose.

This project is being built by a final-year student at IIT Kharagpur for SDE placement interviews. Every feature and architectural decision must be interview-explainable — not just working, but understandable and defensible.

---

## Project Status

Refer to `TO-DO.md` for the current phase and completed tasks. Always check TO-DO.md before starting work to understand exactly where we are and what comes next. Do not skip phases or implement features out of order.

---

## Repository Structure

```
geosync/
├── server.js                  # Entry point — Express + Socket.IO server
├── package.json
├── .env                       # Environment variables (never commit)
├── .env.example               # Documented variable names (safe to commit)
├── docker-compose.yml         # Full stack orchestration
├── Dockerfile                 # Node.js server container
├── nginx.conf                 # Reverse proxy config
├── init.sql                   # PostgreSQL schema + PostGIS setup
│
├── public/                    # Static files served by Express
│   ├── index.html
│   ├── style.css
│   └── app.js                 # All client-side logic
│
├── src/                       # Server-side modules (added from Phase 3 onward)
│   ├── routes/
│   │   └── auth.js            # POST /api/register, POST /api/login
│   │   └── history.js         # GET /api/history/:userId
│   │   └── geofences.js       # POST /api/geofences, GET /api/geofences/:roomId
│   │   └── heatmap.js         # GET /api/heatmap/:roomId
│   ├── middleware/
│   │   └── auth.js            # JWT verification middleware
│   │   └── rateLimiter.js     # express-rate-limit configs
│   ├── socket/
│   │   └── handlers.js        # All Socket.IO event handlers
│   │   └── middleware.js      # Socket.IO auth + throttle middleware
│   └── db/
│       └── index.js           # PostgreSQL connection pool (pg)
│       └── queries.js         # All raw SQL queries as named functions
│
└── docs/
    ├── CLAUDE.md
    ├── ARCHITECTURE.md
    ├── TO-DO.md
    ├── TECH-STACK.md
    ├── CONVENTIONS.md
    └── ENV.md
```

---

## How to Run the Project

### Development (no Docker)
```bash
# Install dependencies
npm install

# Start Redis locally (must be running before server)
redis-server

# Start PostgreSQL locally and run init.sql once
psql -U postgres -f init.sql

# Start the server with nodemon
npm run dev
```

### Full stack with Docker
```bash
docker-compose up --build
```

### Environment
Copy `.env.example` to `.env` and fill in all values before running. See `ENV.md` for descriptions of every variable.

---

## Rules — Follow These Without Exception

### 1. Never break working phases
If Phase 2 is complete and working, adding Phase 3 code must not break Phase 2 functionality. Test the previous phase after every addition.

### 2. Never use `io.emit()` after Phase 3
Once rooms are implemented, all location broadcasts must be scoped to a room using `io.to(roomCode).emit()`. Global broadcasts break the privacy model.

### 3. Never store passwords in plain text
Always use `bcrypt.hash()` with a salt round of 12. Never log passwords. Never return password hashes in API responses.

### 4. Never commit `.env`
The `.env` file must never be committed to version control. `.env.example` with placeholder values is committed instead.

### 5. Always validate inputs before database queries
Use `express-validator` on all REST endpoints. Malformed lat/lng values, empty strings, and missing fields must return a 400 error — never reach the database.

### 6. Always handle socket disconnects
Every socket event handler that modifies shared state must have a corresponding cleanup in the `disconnect` handler. Stale entries in `users` object or Redis must be removed on disconnect.

### 7. Database queries are always async
All database calls use `async/await` with try/catch. Never use `.then()` chains in route handlers. Failed queries must return appropriate HTTP status codes, not crash the server.

### 8. Keep `server.js` clean
`server.js` is the entry point only — it wires things together. Business logic lives in `src/`. If a handler in `server.js` grows beyond ~10 lines, move it to the appropriate module in `src/`.

### 9. One concern per file
Route handlers handle HTTP. Socket handlers handle WebSocket events. DB queries live in `db/queries.js`. Middleware lives in `middleware/`. Do not mix these concerns.

### 10. Comment every non-obvious decision
If a piece of code exists for a specific architectural reason (e.g. why Redis stores geofence state vs PostgreSQL), add a one-line comment explaining why. These comments are interview prep — they remind the developer what to say.

---

## Key Architectural Decisions to Remember

**Why Socket.IO over raw WebSockets?** — Automatic fallback to long-polling, built-in rooms, reconnection handling, and a cleaner event API. Raw WebSockets would require implementing all of this manually.

**Why Redis for socket state vs in-memory?** — In-memory state lives in a single Node process. Redis is external and shared — multiple Node instances can all read and write to it, enabling horizontal scaling without sticky sessions.

**Why PostGIS over storing lat/lng as floats?** — PostGIS provides spatial data types, spatial indexing (GIST), and spatial functions (ST_Within, ST_Distance, ST_AsGeoJSON) that would require hundreds of lines of manual math to replicate. Geofencing accuracy at scale requires a proper spatial engine.

**Why ST_Within on the server vs point-in-polygon in JavaScript?** — Server-side PostGIS runs the check against a spatially-indexed database — O(log n) per query. Client-side JavaScript would require sending all polygon coordinates to every client and running O(n·m) checks in the browser on every update.

**Why bcrypt with salt round 12?** — Salt round 12 means 2^12 = 4096 hashing iterations. Slow enough to make brute-force attacks impractical, fast enough to not noticeably delay login on a server.

---

## Interview Preparation Notes

When asked about this project in an interview, the talking points for each major component are:

- **WebSockets:** HTTP upgrade handshake, persistent TCP connection, why polling fails at scale, Socket.IO as an abstraction layer
- **Redis:** Pub/Sub mechanism, PUBLISH/SUBSCRIBE commands, why shared state across processes requires an external store
- **PostGIS:** Spatial data types, GIST indexing, ST_Within for geofencing, why spatial queries belong in the database not the application layer
- **JWT:** Header.payload.signature structure, stateless authentication, why JWTs don't need a session store, token expiry and refresh strategy
- **Rate limiting:** Token bucket vs leaky bucket algorithms, why HTTP and WebSocket layers need separate rate limiting, socket flooding attack vector
- **Docker Compose:** Container networking, service dependencies (Node waits for Postgres and Redis), volume mounts for data persistence, environment variable injection
