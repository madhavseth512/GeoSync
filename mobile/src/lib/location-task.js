import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL, PING_DISTANCE_M, PING_MIN_INTERVAL_MS } from './config';
import { colors } from './theme';

export const LOCATION_TASK = 'geosync-background-location';

const TOKEN_KEY = 'geosync_token';
const ROOM_KEY = 'geosync_active_room';

// The background task can't read React state, so the room we're sharing to is
// persisted here and read back inside the headless task.
export async function setActiveRoom(roomCode) {
  await AsyncStorage.setItem(ROOM_KEY, roomCode);
}
export async function clearActiveRoom() {
  await AsyncStorage.removeItem(ROOM_KEY);
}

// ── The background task ───────────────────────────────────────────────────────
// Runs in a HEADLESS JS context when the OS delivers a location — including when
// the screen is locked or the app is swiped away. It cannot use the app's
// Socket.IO connection (that dies when backgrounded), so it reports position
// over plain HTTP to POST /api/location, which broadcasts to the room server-side.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error.message);
    return;
  }

  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  // Only report the freshest fix — the OS may batch several.
  const loc = locations[locations.length - 1];

  const [token, roomCode] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(ROOM_KEY),
  ]);

  // Not logged in, or not in a room — nothing to share.
  if (!token || !roomCode) return;

  try {
    await fetch(`${API_BASE_URL}/api/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        roomCode,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      }),
    });
  } catch {
    // Offline or server unreachable — drop this ping. The next fix carries a
    // fresher position anyway, so queuing stale points isn't worth it.
  }
});

// Post a single position to the API. Used by the background task, by the "I'm
// here" ping on joining a room, and by the foreground heartbeat.
export async function postLocation(lat, lng) {
  const [token, roomCode] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(ROOM_KEY),
  ]);
  if (!token || !roomCode) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode, lat, lng }),
    });
    return res.ok;
  } catch {
    return false; // offline — the next fix carries a fresher position anyway
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────
export async function startBackgroundTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,

    // Distance-based sampling: only report after the user has ACTUALLY moved.
    // This is the big win — it cuts pings (and battery, DB rows, and Redis
    // commands) by ~35x versus firing every 5 seconds while standing still.
    //
    // IMPORTANT TRAP: on Android this maps to smallestDisplacement, which means a
    // STATIONARY device receives NO updates at all — timeInterval does not
    // override it. So this alone would make a motionless user invisible forever.
    // That's why callers must also send an initial "I'm here" ping on joining a
    // room, plus a heartbeat while the app is open (see postLocation).
    distanceInterval: PING_DISTANCE_M,
    timeInterval: PING_MIN_INTERVAL_MS,

    // Android: a persistent notification is MANDATORY for background location.
    // It's also honest — the user can always see that sharing is active.
    foregroundService: {
      notificationTitle: 'GeoSync is sharing your location',
      notificationBody: 'Your room can see your live position. Tap to open.',
      notificationColor: colors.green,
    },

    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });
}

export async function stopBackgroundTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

// Foreground + background permissions. Background ("Allow all the time") must be
// requested AFTER foreground is granted — Android requires that order.
export async function requestTrackingPermissions() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { granted: false, background: false };

  const bg = await Location.requestBackgroundPermissionsAsync();
  return { granted: true, background: bg.status === 'granted' };
}
