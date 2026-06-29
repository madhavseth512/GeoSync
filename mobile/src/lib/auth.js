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

// Lightweight JWT expiry check. RN (Hermes) provides atob; if decoding fails for
// any reason we treat the token as unusable and force re-login. We do NOT trust
// this for security — the server still verifies every token. It just avoids
// showing the room screen with an obviously-expired token on boot.
export function isTokenExpired(token) {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
