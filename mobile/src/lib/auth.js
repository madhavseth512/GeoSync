import AsyncStorage from '@react-native-async-storage/async-storage';

// JWT + username persistence. Replaces the web client's localStorage usage.
const TOKEN_KEY = 'geosync_token';
const USERNAME_KEY = 'geosync_username';

export async function setSession(token, username) {
  await AsyncStorage.multiSet([
    [TOKEN_KEY, token],
    [USERNAME_KEY, username],
  ]);
}

export async function getToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function getUsername() {
  return AsyncStorage.getItem(USERNAME_KEY);
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USERNAME_KEY]);
}

// Decode the JWT payload. Not a security check — the server verifies every token;
// this just lets the client read its own userId/expiry without another round trip.
function decodeToken(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// Lightweight JWT expiry check — avoids showing the room screen with an
// obviously-expired token on boot.
export function isTokenExpired(token) {
  const payload = decodeToken(token);
  if (!payload) return true;
  return payload.exp * 1000 < Date.now();
}

// Our own userId, read from the JWT ({ userId, username }). Used to tell which
// map marker is us — markers are keyed by userId, so matching on username would
// be fragile.
export async function getUserId() {
  const token = await getToken();
  if (!token) return null;
  const payload = decodeToken(token);
  return payload?.userId ?? null;
}
