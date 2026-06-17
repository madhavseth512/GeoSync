# MOBILE-MIGRATION.md — GeoSync Web → Android (React Native)

> Forward-looking plan. **No code has been written for this yet.** This document
> captures the decisions and roadmap for migrating GeoSync from a web app to a
> native Android app, to be executed after the web project (Phases 1–9) is done.

---

## Why migrate at all

GeoSync's core value is **continuous location tracking**. The web app cannot do
this: browsers deliberately block background geolocation.

- `navigator.geolocation` only works while the page is **open and in the
  foreground**. Lock the screen or switch apps → the browser suspends the tab's
  JavaScript → `watchPosition()` stops → no pings recorded or shared for that
  period (a gap in history).
- This is a **web-platform limitation** (battery + privacy), not a bug in our code.
- PWA + Background Sync does **not** solve it. The fatal blocker: **service
  workers have no access to `navigator.geolocation`** (it is window-context only).
  Periodic Background Sync also has a ~12h minimum interval, is unsupported on
  iOS, and service workers are killed after each event — no continuous loop.

**Only a native app** can track with the screen locked, via the OS background-
location permission + a foreground service notification. The web app remains the
artifact that built and proved the architecture; the production form is mobile.

---

## Locked-in decisions

| Decision | Choice | Rationale |
|---|---|---|
| Target platform | **Android first** | Free APK sharing, no store fee, builds on Windows (iOS needs a Mac + $99/yr) |
| Frontend approach | **React Native** (full native rewrite) | Genuinely native UX + résumé value (chosen over the lower-effort Capacitor path) |
| Distribution | **Free APK sideload** | Send the APK directly to friends — no Play Store, no payment |
| Background location | **Free library** (`expo-location` background task, or another free lib) | Avoids the paid transistorsoft Android release license |
| Backend deployment | **Free cloud stack** (Render + Neon/Supabase + Upstash) | $0, always-on, same backend as web |
| iOS | **Deferred / optional** | Requires $99/yr + a Mac; revisit only if needed |

---

## What does NOT change — the entire backend

The migration is a **frontend swap**. The mobile app talks to the same REST API
and Socket.IO server. These files are reused as-is:

- `server.js`
- `src/routes/auth.js`, `history.js`, `geofences.js`, `heatmap.js`
- `src/socket/handlers.js`, `src/socket/middleware.js`
- `src/db/*`, `init.sql`
- `src/middleware/*`, `src/redis.js`

Only possible backend tweak: **CORS** — native clients don't send a browser
`Origin`, so `CLIENT_ORIGIN` handling may need relaxing/adjusting. Logic unchanged.

> Result: ~95% of the codebase (the hard part) is reused. This is the payoff of
> the clean REST + Socket.IO separation built in Phases 3–6.

---

## What DOES change — the frontend (`public/` → React Native project)

The entire `public/` folder is replaced by a new React Native app. Map of the
web pieces to their RN replacements:

| Web piece | React Native replacement | Change |
|---|---|---|
| `index.html` + `style.css` (3-screen UI) | RN components + `StyleSheet` | Full rewrite |
| Leaflet map + markers/polylines | `react-native-maps` (Google Maps) | Full rewrite (Leaflet is DOM-based, can't run natively) |
| Leaflet.draw (geofence polygons) | `react-native-maps` `Polygon` + custom draw logic | Full rewrite |
| Leaflet.heat (heatmap) | `react-native-maps-heatmap` or equivalent | Full rewrite |
| `navigator.geolocation.watchPosition` | `expo-location` background task (free) | New + background-capable |
| `localStorage` (JWT) | `@react-native-async-storage/async-storage` | Swap |
| `fetch` calls | `fetch` (same in RN) | No change |
| `socket.io-client` | `socket.io-client` (works in RN) | Minimal — same library |

**API contract knowledge transfers directly:** same endpoints, same socket
events (`join-room`, `send-location`, `receive-location`, `geofence-alert`,
`geofence-removed`), same JWT-Bearer flow.

---

## The genuinely new work: background geolocation

This is the whole reason for migrating.

- **Library:** `expo-location` with a background location task
  (`Location.startLocationUpdatesAsync` + `TaskManager`) — **free** on Android.
  (Avoid transistorsoft `react-native-background-geolocation` — paid for Android
  release builds.)
- **Permissions:** request `ACCESS_FINE_LOCATION` **and**
  `ACCESS_BACKGROUND_LOCATION` ("Allow all the time" on Android 10+).
- **Foreground service + persistent notification:** Android *requires* a visible
  "GeoSync is tracking your location" notification for background GPS. Also good
  for user transparency.
- **Logic:** the background task receives coordinates even when the screen is
  locked → forward them via the same `socket.emit('send-location', { lat, lng })`.
  The server has no idea the source changed.

This closes the gap the web app couldn't: **locked screen → tracking continues.**

---

## Free Android APK distribution

Android (unlike iOS) allows direct, free, open distribution:

1. **Build the APK** — for free, on Windows:
   - **EAS Build** (Expo, cloud) — builds the Android APK in the cloud, free tier.
   - or **local build** via Android Studio / Gradle (Android tooling runs on
     Windows — no Mac needed).
2. **Share the APK file** directly (Drive / WhatsApp / email). No store, no fee,
   no accounts.
3. **Friends install it:**
   - Tap APK → allow "install from unknown source" (one-time toggle)
   - Grant location **"Allow all the time"**
   - See the persistent tracking notification while it runs

> Google Play's **$25 one-time** fee is **only** needed for a public Play Store
> listing — NOT required for sharing an APK with friends.

---

## Free backend deployment (same as web Phase 9, on free tiers)

The APK is only the client — the backend still runs publicly with HTTPS so the
app can reach it from anywhere.

| Component | Free service | Notes |
|---|---|---|
| Node + Socket.IO server | **Render** (free web service) | Sleeps after ~15 min idle → cold start on first hit; 750 hrs/mo free |
| PostgreSQL + PostGIS | **Neon** or **Supabase** | Both free, both support the PostGIS extension |
| Redis | **Upstash** | Free serverless Redis (needed for geofence enter/exit state) |

Setup: point `.env` at the cloud DB/Redis URLs (never commit — `.env.example`
pattern), run `init.sql` once on the cloud Postgres, then deploy the Node app and
set the APK's API base URL to the public Render URL.

---

## Effort estimate

| Area | Effort | Cost |
|---|---|---|
| Backend changes | ~none (minor CORS) | $0 |
| Frontend rewrite (RN) | **Weeks** — full UI + map + draw + heatmap rebuild | $0 |
| Background location | Days — library + permissions + foreground service | $0 |
| APK build + distribution | Small (EAS or local Gradle) | $0 |
| Backend free deploy | Small–medium (Render + Neon + Upstash) | $0 |

**Total cost: $0. Total cost is time, not money.** React Native is the larger-
effort path (vs Capacitor) but was chosen deliberately for native UX + résumé.

---

## Optional future enhancements (not in scope now)

- **Push notifications** (geofence alerts while app backgrounded): FCM on the
  backend + device-token storage + client handling. New backend module.
- **iOS version:** requires Apple Developer Program ($99/yr) + a Mac (or EAS
  cloud build) + TestFlight for distribution. Deferred.

---

## Interview demo plan (Android, free)

1. Deploy backend on the free cloud stack → public HTTPS URL.
2. Build the APK, point it at that URL.
3. Share the APK with 3–4 Android-using friends; all join the **same room**.
4. Over **4–5 days**, they move around with the app installed — background
   tracking means **they do NOT keep anything open**.
5. Collect **screenshots / a demo video** from them showing the four features:
   - **Route tracking** — live markers moving
   - **Location history** — a user's path polyline
   - **Heatmap density** — gradient where people spent time
   - **Geofence boundaries** — drawn zones + enter/exit alerts
6. Put the demo video + screenshots in `README.md` for the interviewer.

**Narrative:** *"The web version built and proved the real-time architecture.
The production form is a native Android app with true background location,
distributed as a free APK. The backend is unchanged — the clean REST + Socket.IO
separation made the client swappable."*
