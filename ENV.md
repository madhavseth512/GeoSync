# ENV.md — Environment Variables Reference

> This file documents every environment variable GeoSync uses.
> Copy `.env.example` to `.env` and fill in real values before running the project.
> Never commit `.env`. Always keep `.env.example` up to date when adding new variables.

---

## How to Set Up

```bash
# In the project root
cp .env.example .env
# Then edit .env with real values
```

---

## Complete Variable Reference

### Server Configuration

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `PORT` | number | No | `3000` | Port the Node.js server listens on |
| `NODE_ENV` | string | No | `development` | Set to `production` when deployed. Affects error verbosity and security settings |
| `CLIENT_ORIGIN` | string | Yes | — | The exact URL of the frontend client. Used for CORS. In development: `http://localhost:3000`. In production: your live domain |

```env
PORT=3000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:3000
```

---

### JWT Authentication

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `JWT_SECRET` | string | Yes | — | Secret key used to sign and verify JWTs. Must be long (32+ characters), random, and kept private. If this is compromised, all tokens can be forged |
| `JWT_EXPIRY` | string | No | `24h` | How long a JWT remains valid. Format: `60` (seconds), `15m`, `24h`, `7d`. After expiry, the user must log in again |

```env
JWT_SECRET=replace_this_with_a_long_random_string_minimum_32_characters
JWT_EXPIRY=24h
```

**How to generate a secure JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

### PostgreSQL Database

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `DB_HOST` | string | Yes | — | PostgreSQL server hostname. In Docker Compose: `postgres` (service name). In local dev: `localhost` |
| `DB_PORT` | number | No | `5432` | PostgreSQL port |
| `DB_NAME` | string | Yes | — | Database name to connect to. Must exist before the server starts |
| `DB_USER` | string | Yes | — | PostgreSQL username |
| `DB_PASSWORD` | string | Yes | — | PostgreSQL password |
| `DB_MAX_CONNECTIONS` | number | No | `10` | Maximum connections in the pool. Increase for high traffic, decrease to avoid exhausting Postgres |

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=geosync
DB_USER=geosync_user
DB_PASSWORD=replace_with_strong_password
DB_MAX_CONNECTIONS=10
```

**How these are used in `src/db/index.js`:**
```javascript
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      process.env.DB_MAX_CONNECTIONS || 10,
})
```

---

### Redis

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `REDIS_HOST` | string | Yes | — | Redis server hostname. In Docker Compose: `redis` (service name). In local dev: `localhost` |
| `REDIS_PORT` | number | No | `6379` | Redis port |
| `REDIS_PASSWORD` | string | No | — | Redis password. Not required for local dev but must be set in production |

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

**How these are used in `server.js`:**
```javascript
const pubClient = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD || undefined,
})
const subClient = pubClient.duplicate()
```

---

### Rate Limiting

| Variable | Type | Required | Default | Description |
|---|---|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | number | No | `900000` | Time window for rate limiting in milliseconds. Default is 15 minutes (15 × 60 × 1000) |
| `RATE_LIMIT_AUTH_MAX` | number | No | `20` | Max login/register requests per window per IP |
| `RATE_LIMIT_API_MAX` | number | No | `100` | Max general API requests per window per IP |
| `SOCKET_THROTTLE_INTERVAL_MS` | number | No | `4000` | Minimum milliseconds between `send-location` events from one socket. Events arriving faster are dropped |
| `SOCKET_MAX_VIOLATIONS` | number | No | `10` | Number of throttle violations before a socket is disconnected |

```env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_AUTH_MAX=20
RATE_LIMIT_API_MAX=100
SOCKET_THROTTLE_INTERVAL_MS=4000
SOCKET_MAX_VIOLATIONS=10
```

---

## `.env.example` File

The following is the exact content of `.env.example` — copy this file and fill in real values:

```env
# ─── Server ────────────────────────────────────────────
PORT=3000
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:3000

# ─── JWT ───────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=replace_this_with_a_long_random_string_minimum_32_characters
JWT_EXPIRY=24h

# ─── PostgreSQL ─────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5432
DB_NAME=geosync
DB_USER=geosync_user
DB_PASSWORD=replace_with_strong_password
DB_MAX_CONNECTIONS=10

# ─── Redis ──────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ─── Rate Limiting ──────────────────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_AUTH_MAX=20
RATE_LIMIT_API_MAX=100
SOCKET_THROTTLE_INTERVAL_MS=4000
SOCKET_MAX_VIOLATIONS=10
```

---

## Docker Compose Variable Injection

When running with Docker Compose, environment variables are injected into containers from the `.env` file automatically. The `docker-compose.yml` references them like this:

```yaml
services:
  node:
    environment:
      - PORT=${PORT}
      - NODE_ENV=${NODE_ENV}
      - JWT_SECRET=${JWT_SECRET}
      - JWT_EXPIRY=${JWT_EXPIRY}
      - DB_HOST=postgres        # Override to use Docker service name
      - DB_PORT=${DB_PORT}
      - DB_NAME=${DB_NAME}
      - DB_USER=${DB_USER}
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_HOST=redis        # Override to use Docker service name
      - REDIS_PORT=${REDIS_PORT}
      - REDIS_PASSWORD=${REDIS_PASSWORD}

  postgres:
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
```

Note: `DB_HOST` and `REDIS_HOST` are overridden to the Docker service names (`postgres` and `redis`) inside Docker Compose, regardless of what is set in `.env`. The `.env` values for those two variables are only used for local development outside Docker.

---

## Production Checklist

Before deploying to a live server:

- [ ] `JWT_SECRET` is a randomly generated string of 64+ hex characters — not a human-readable phrase
- [ ] `DB_PASSWORD` and `REDIS_PASSWORD` are strong, unique passwords
- [ ] `NODE_ENV` is set to `production`
- [ ] `CLIENT_ORIGIN` is set to the exact production domain (no trailing slash)
- [ ] `.env` is in `.gitignore` and has never been committed
- [ ] All variables are set as environment secrets in the deployment platform (Railway / Render / EC2)
