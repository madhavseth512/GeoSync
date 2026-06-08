# CONVENTIONS.md — GeoSync Code Conventions

> These conventions apply to every file in this project.
> Claude Code must follow these without exception. Consistency across sessions is the goal.

---

## Folder Structure Rules

```
geosync/
├── server.js              # Entry point ONLY — wires modules together, no business logic
├── package.json
├── .env                   # Never committed
├── .env.example           # Always committed, placeholder values only
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── init.sql               # Complete DB schema — must be runnable from scratch
│
├── public/                # Everything served statically to the browser
│   ├── index.html         # Single HTML file — no templating
│   ├── style.css          # All styles in one file until it exceeds ~300 lines
│   └── app.js             # All client-side JS in one file until Phase 6+
│
├── src/                   # All server-side modules
│   ├── routes/            # Express route handlers — one file per resource
│   │   ├── auth.js        # /api/register, /api/login
│   │   ├── history.js     # /api/history/:userId
│   │   ├── geofences.js   # /api/geofences
│   │   └── heatmap.js     # /api/heatmap/:roomId
│   ├── middleware/        # Express and Socket.IO middleware
│   │   ├── auth.js        # verifyToken — JWT verification for HTTP routes
│   │   └── rateLimiter.js # express-rate-limit configurations
│   ├── socket/            # All Socket.IO logic
│   │   ├── handlers.js    # Event handlers: send-location, join-room, disconnect
│   │   └── middleware.js  # io.use() — socket auth + throttle
│   └── db/               # Database layer
│       ├── index.js       # Connection pool — export single `pool` instance
│       └── queries.js     # All SQL queries as named async functions
│
└── docs/                  # All project documentation
    ├── CLAUDE.md
    ├── ARCHITECTURE.md
    ├── TO-DO.md
    ├── TECH-STACK.md
    ├── CONVENTIONS.md
    └── ENV.md
```

**Rules:**
- `server.js` only imports modules and wires them together — it does not contain logic
- Route files only handle HTTP request/response — no SQL, no socket logic
- `db/queries.js` is the only file that contains SQL strings
- Socket handlers only live in `src/socket/handlers.js`
- Middleware only lives in `src/middleware/`

---

## Naming Conventions

### Files and folders
- All file and folder names: `kebab-case`
- Example: `rate-limiter.js`, `socket-handlers.js` ✓
- Never: `rateLimiter.js`, `SocketHandlers.js` ✗

### Variables and functions
- `camelCase` for all variables and function names
- Example: `const roomCode`, `function verifyToken()` ✓
- Never: `const room_code`, `function VerifyToken()` ✗

### Constants
- `SCREAMING_SNAKE_CASE` for true constants (values that never change)
- Example: `const MAX_VIOLATIONS = 10`, `const JWT_EXPIRY = '24h'` ✓

### Database columns
- `snake_case` for all database column names
- Example: `user_id`, `password_hash`, `created_at` ✓

### Socket.IO event names
- `kebab-case` for all socket event names
- Example: `'send-location'`, `'receive-location'`, `'user-disconnected'`, `'geofence-alert'` ✓
- Never: `'sendLocation'`, `'SEND_LOCATION'` ✗

### API routes
- `kebab-case` for URL segments
- Example: `/api/geofences`, `/api/history/:userId` ✓
- Never: `/api/geofences`, `/api/getHistory` ✗
- RESTful resource naming — nouns not verbs:
  - `GET /api/geofences/:roomId` ✓ (not `/api/getGeofences`)
  - `POST /api/geofences` ✓ (not `/api/createGeofence`)
  - `DELETE /api/geofences/:id` ✓ (not `/api/deleteGeofence`)

---

## Code Style

### General
- 2-space indentation throughout — no tabs
- Single quotes for strings in JavaScript: `'hello'` not `"hello"`
- Semicolons required at end of statements
- Maximum line length: 100 characters
- One blank line between logical sections within a function
- Two blank lines between top-level declarations (functions, classes)

### Variable declarations
- Always use `const` by default
- Use `let` only when the variable will be reassigned
- Never use `var`

```javascript
// ✓ Correct
const express = require('express')
const app = express()
let connectionCount = 0

// ✗ Wrong
var express = require('express')
```

### Arrow functions vs regular functions
- Named functions that are exported or used as event handlers: regular function declarations
- Inline callbacks and short transformations: arrow functions

```javascript
// ✓ Named handler — regular function
function handleConnection(socket) {
  socket.on('send-location', handleLocationUpdate)
}

// ✓ Inline callback — arrow function
users.filter(user => user.roomCode === roomCode)
```

### Destructuring
- Always destructure when extracting multiple properties from an object

```javascript
// ✓ Correct
const { lat, lng } = data
const { JWT_SECRET, PORT } = process.env

// ✗ Avoid
const lat = data.lat
const lng = data.lng
```

---

## Async / Error Handling

### All async functions use async/await — never .then()
```javascript
// ✓ Correct
async function getUserById(id) {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id])
  return result.rows[0]
}

// ✗ Wrong
function getUserById(id) {
  return pool.query('SELECT * FROM users WHERE id = $1', [id])
    .then(result => result.rows[0])
}
```

### All route handlers have try/catch
```javascript
// ✓ Correct
router.post('/login', async (req, res) => {
  try {
    const user = await getUserByUsername(req.body.username)
    // ...
    res.json({ token })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

### HTTP status codes — use correctly
| Situation | Code |
|---|---|
| Success, returns data | 200 |
| Success, resource created | 201 |
| Bad input / validation failure | 400 |
| Not authenticated (no/invalid token) | 401 |
| Authenticated but not authorised | 403 |
| Resource not found | 404 |
| Too many requests (rate limit) | 429 |
| Server error | 500 |

### Socket.IO error handling
- Always wrap socket handlers in try/catch
- On error, emit an `error` event back to the sender — never crash the server

```javascript
// ✓ Correct
socket.on('send-location', async (data) => {
  try {
    // handler logic
  } catch (err) {
    console.error(`send-location error [${socket.id}]:`, err)
    socket.emit('error', { message: 'Failed to process location update' })
  }
})
```

### Database errors
- Log the full error to console with context (which query, which user)
- Return generic message to client — never expose SQL errors or stack traces in HTTP responses

```javascript
// ✓ Correct
catch (err) {
  console.error('insertLocationPing failed:', { userId, lat, lng, err })
  // Do NOT: res.json({ error: err.message }) -- exposes internals
  res.status(500).json({ error: 'Database error' })
}
```

---

## Database Query Conventions

### All queries are named functions in `src/db/queries.js`
```javascript
// ✓ Every query is a named, exported async function
async function insertLocationPing(userId, lat, lng) {
  const query = `
    INSERT INTO location_pings (user_id, geom, timestamp)
    VALUES ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326), NOW())
  `
  await pool.query(query, [userId, lat, lng])
}

module.exports = { insertLocationPing }
```

### Always use parameterised queries — never string interpolation
```javascript
// ✓ Correct — parameterised
pool.query('SELECT * FROM users WHERE username = $1', [username])

// ✗ NEVER — SQL injection vulnerability
pool.query(`SELECT * FROM users WHERE username = '${username}'`)
```

### Coordinate order in PostGIS
PostGIS `ST_MakePoint` takes **longitude first, then latitude** — opposite of how Leaflet uses coordinates. Always comment this:

```javascript
// PostGIS ST_MakePoint(longitude, latitude) — note: lng before lat
ST_SetSRID(ST_MakePoint($3, $2), 4326)
//                       lng  lat
```

---

## Client-Side Conventions (public/app.js)

### Marker management
- Store all remote user markers in a single object: `const markers = {}`
- Key: `socket.id` of the remote user
- Value: the Leaflet marker instance
- Always check `if (markers[id])` before calling `.setLatLng()` — never assume a marker exists

```javascript
// ✓ Correct pattern for receiving location updates
socket.on('receive-location', ({ id, lat, lng, username }) => {
  if (markers[id]) {
    markers[id].setLatLng([lat, lng])
  } else {
    markers[id] = L.marker([lat, lng])
      .addTo(map)
      .bindPopup(username)
  }
})

// ✓ Correct pattern for removing disconnected users
socket.on('user-disconnected', (id) => {
  if (markers[id]) {
    map.removeLayer(markers[id])
    delete markers[id]
  }
})
```

### No `alert()` in production code
- Use a toast notification div for user-facing messages
- `console.error()` for developer messages
- Never use `alert()`, `confirm()`, or `prompt()`

---

## Comments

### When to comment
- Every non-obvious architectural decision: `// Using Redis here (not in-memory) so this works across multiple Node instances`
- Every PostGIS query: explain what spatial function is doing
- Every rate-limit or security check: explain what attack it prevents
- Every Socket.IO room operation: explain why scoped to room

### When NOT to comment
- Obvious code: `// increment counter` above `count++`
- Variable declarations that name themselves clearly
- Standard library calls that any JS developer would recognise

### Comment style
```javascript
// Single line comments use double-slash with a space after

/*
  Multi-line comments for explaining complex logic
  that requires more than one sentence.
*/
```

---

## Git Conventions

### Commit message format
```
<phase>: <short description>

Examples:
phase1: add Express server with static file serving
phase2: add Socket.IO location broadcast
phase3: add JWT authentication and private rooms
phase4: add rate limiting and helmet security headers
fix: handle disconnect cleanup for empty rooms
refactor: move socket handlers to src/socket/handlers.js
```

### Never commit
- `.env` (real secrets)
- `node_modules/`
- Any file containing actual passwords, tokens, or API keys
