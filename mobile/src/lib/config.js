// Central configuration for the GeoSync mobile app.
//
// API_BASE_URL must point at the running GeoSync backend. Pick the right value
// for how you're testing:
//   - Android emulator → host machine:  http://10.0.2.2:3000
//   - Physical device on same Wi-Fi:     http://<your-PC-LAN-IP>:3000
//   - Production (set in M1):            the deployed HTTPS URL
//
// This is overridden with the free cloud deployment URL once M1 is done.
//
// Current value = Android emulator's alias for the host PC's localhost.
// (A physical phone via Wi-Fi would instead use this PC's LAN IP, e.g.
// http://192.168.29.216:3000.)
export const API_BASE_URL = 'http://10.0.2.2:3000';

// ── Location sampling ────────────────────────────────────────────────────────
// Distance-based, NOT time-based. We only report a position once the user has
// actually moved PING_DISTANCE_M metres. Standing still produces no pings.
//
// Why this matters: firing every 5s regardless would generate ~17k pings per
// user per day — draining battery and blowing through free-tier DB/Redis limits
// during the multi-day field test. Moving-only sampling cuts that ~35x.
export const PING_DISTANCE_M = 30;          // report after ~30 m of movement
export const PING_MIN_INTERVAL_MS = 30000;  // and never more often than every 30 s
