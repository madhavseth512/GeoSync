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
// Current value = this PC's Wi-Fi LAN IP, for testing via Expo Go on a phone on
// the same Wi-Fi. (Android emulator would instead use http://10.0.2.2:3000.)
export const API_BASE_URL = 'http://192.168.29.216:3000';
