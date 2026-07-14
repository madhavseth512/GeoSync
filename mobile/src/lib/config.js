// Central configuration for the GeoSync mobile app.
//
// API_BASE_URL points at the deployed backend (Render + Neon Postgres/PostGIS).
// This MUST be the public HTTPS URL for the shared APK: friends' phones are on
// their own mobile networks and cannot reach a laptop on your Wi-Fi.
//
// For local development against a backend on this machine, swap it for:
//   - Android emulator → host:        http://10.0.2.2:3000
//   - Physical phone on same Wi-Fi:   http://<this-PC's-LAN-IP>:3000
export const API_BASE_URL = 'https://geosync-api-vh6b.onrender.com';

// ── Location sampling ────────────────────────────────────────────────────────
// Distance-based, NOT time-based. We only report a position once the user has
// actually moved PING_DISTANCE_M metres. Standing still produces no pings.
//
// Why this matters: firing every 5s regardless would generate ~17k pings per
// user per day — draining battery and blowing through free-tier DB/Redis limits
// during the multi-day field test. Moving-only sampling cuts that ~35x.
export const PING_DISTANCE_M = 30;          // report after ~30 m of movement
export const PING_MIN_INTERVAL_MS = 30000;  // and never more often than every 30 s
