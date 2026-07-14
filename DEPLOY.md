# DEPLOY.md — GeoSync backend on free infrastructure

The GeoSync backend is a pure JSON + Socket.IO API. The frontend is the Android
app in `mobile/`, so the friends who install the APK need this API reachable on a
public HTTPS URL — a laptop on your Wi-Fi is not enough.

**Total cost: ₹0.** No paid tiers, no card required for the core path.

| Piece | Service | Free tier |
|---|---|---|
| API (Node + Socket.IO) | **Render** | Free web service, HTTPS + WebSockets |
| Postgres + PostGIS | **Neon** | Free, supports the PostGIS extension |
| Redis *(optional)* | Redis Cloud / Upstash | Optional — see below |

> **Redis is optional.** It stores geofence enter/exit state. If `REDIS_URL` is
> unset, the server falls back to in-memory state, which is *correct* for a single
> instance (which is what the free tier runs). Add Redis only if you want the
> state to survive restarts or you scale to multiple instances.

---

## 1. Database — Neon (Postgres + PostGIS)

1. Sign up at **neon.tech** → create a project (choose a region near you).
2. In the Neon SQL editor, enable PostGIS:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
3. Paste and run the rest of **`init.sql`** (tables + indexes).
4. Copy the **connection string**. It looks like:
   ```
   postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it — this becomes `DATABASE_URL`.

> TLS is mandatory on Neon. `src/db/index.js` switches to a TLS pool automatically
> whenever `DATABASE_URL` is present, so nothing else to configure.

---

## 2. API — Render

1. Push the repo to GitHub (Render deploys from GitHub).
2. Sign up at **render.com** → **New → Blueprint** → pick this repo.
   Render reads **`render.yaml`** and configures the service automatically.
3. When prompted, set the secret env var:
   - **`DATABASE_URL`** = the Neon connection string from step 1.
   - *(Optional)* **`REDIS_URL`** if you provisioned Redis.
4. Deploy. Render gives you a URL like:
   ```
   https://geosync-api.onrender.com
   ```

`render.yaml` already sets the rest: `NODE_ENV`, `TRUST_PROXY=true` (Render is
behind a proxy — without it, rate limits would key every user to the proxy's IP),
`USE_REDIS_ADAPTER=false` (one instance has no peers to fan out to, so the adapter
would spend a Redis PUBLISH per broadcast for nothing), a generated `JWT_SECRET`,
and the rate-limit knobs.

---

## 3. Verify the deployment

```bash
curl https://<your-service>.onrender.com/health
# -> {"ok":true,"uptime":...}

curl -X POST https://<your-service>.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"tester1","password":"testpass123"}'
```
A `201` (or "user exists") means Node ↔ Neon is wired correctly.

---

## 4. Point the app at it, then build the shareable APK

1. In **`mobile/src/lib/config.js`**, set:
   ```js
   export const API_BASE_URL = 'https://<your-service>.onrender.com';
   ```
2. Build the standalone APK:
   ```bash
   cd mobile
   npx eas-cli@latest build --profile preview --platform android
   ```
3. Download the APK from the link EAS prints and send it to your friends
   (Drive / WhatsApp). They:
   - allow **install from unknown sources** (one-time),
   - grant location **"Allow all the time"** (required for background tracking),
   - join the **same room code**.

---

## Free-tier caveats worth knowing

| Thing | Reality | Why it's OK |
|---|---|---|
| **Render sleeps** after ~15 min idle | First request then takes ~30–60 s to wake | During the field test, background pings keep it warm. Sockets reconnect automatically after an idle gap. |
| **Neon storage** 0.5 GB | Plenty | Pings are distance-based (~30 m), so rows accumulate slowly. |
| **Battery on friends' phones** | Continuous GPS is heavy | Mitigated by distance-based sampling instead of a fixed interval. |

---

## Scaling out later (the Redis story)

Production here runs a **single instance**, so the Socket.IO Redis adapter is
switched off deliberately. To scale horizontally:

1. Provision Redis and set `REDIS_URL`.
2. Set `USE_REDIS_ADAPTER=true`.
3. Raise the instance count.

Broadcasts then fan out across instances via Redis Pub/Sub, and geofence state
becomes shared rather than per-process. Both code paths already exist — it's a
config change, not a rewrite.
