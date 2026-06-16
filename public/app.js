// GeoSync client — Phase 3: JWT auth, private rooms, real-time location.

const INDIA_CENTER = [20.5937, 78.9629];
const INITIAL_ZOOM = 5;

// ── DOM references ────────────────────────────────────────────────────────────
const authScreen    = document.getElementById('auth-screen');
const roomScreen    = document.getElementById('room-screen');
const mapScreen     = document.getElementById('map-screen');

const loginForm     = document.getElementById('login-form');
const registerForm  = document.getElementById('register-form');
const loginError    = document.getElementById('login-error');
const registerError = document.getElementById('register-error');

const welcomeUsername     = document.getElementById('welcome-username');
const createRoomBtn       = document.getElementById('create-room-btn');
const roomCodeDisplay     = document.getElementById('room-code-display');
const generatedCodeEl     = document.getElementById('generated-code');
const enterCreatedRoomBtn = document.getElementById('enter-created-room-btn');
const joinCodeInput       = document.getElementById('join-code-input');
const joinRoomBtn         = document.getElementById('join-room-btn');
const roomError           = document.getElementById('room-error');
const logoutBtn           = document.getElementById('logout-btn');

const activeRoomCodeEl = document.getElementById('active-room-code');
const userCountEl      = document.getElementById('user-count');
const userListEl       = document.getElementById('user-list');
const toastEl          = document.getElementById('toast');
const clearRouteBtn    = document.getElementById('clear-route-btn');

clearRouteBtn.addEventListener('click', clearRoute);

// ── State ─────────────────────────────────────────────────────────────────────
let socket        = null;
let map           = null;
const markers     = {};  // socket.id -> Leaflet marker
const roomUsers   = {};  // socket.id -> username
const socketUserIds = {}; // socket.id -> database userId (for history lookups)
let hasCenteredOnSelf = false;
let currentRoomCode   = null;
let routeLayer        = null; // currently displayed route polyline (only one at a time)

// ── Helpers ───────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 4000);
}

function setScreen(name) {
  authScreen.classList.toggle('hidden', name !== 'auth');
  roomScreen.classList.toggle('hidden', name !== 'room');
  mapScreen.classList.toggle('hidden', name !== 'map');
  mapScreen.style.display = name === 'map' ? 'block' : 'none';
}

function updateUserCount() {
  userCountEl.textContent = `Connected: ${Object.keys(roomUsers).length}`;
}

function addUserToSidebar(id, username) {
  roomUsers[id] = username;
  const li = document.createElement('li');
  li.id = `user-${id}`;
  li.textContent = username;
  li.title = 'Click to show route history';
  li.classList.add('clickable');
  // Click a user to replay their recent route as a polyline.
  li.addEventListener('click', () => showRouteHistory(id, username));
  userListEl.appendChild(li);
  updateUserCount();
}

function removeUserFromSidebar(id) {
  delete roomUsers[id];
  delete socketUserIds[id];
  const li = document.getElementById(`user-${id}`);
  if (li) li.remove();
  updateUserCount();
}

// ── Auth tab switching ────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    loginForm.classList.toggle('hidden', tab !== 'login');
    registerForm.classList.toggle('hidden', tab !== 'register');
    loginError.textContent = '';
    registerError.textContent = '';
  });
});

// ── Register ──────────────────────────────────────────────────────────────────
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.textContent = '';
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      registerError.textContent = data.error || data.errors?.[0]?.msg || 'Registration failed';
      return;
    }

    // Auto-login after successful registration.
    await loginWithCredentials(username, password, registerError);
  } catch {
    registerError.textContent = 'Network error — is the server running?';
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  await loginWithCredentials(username, password, loginError);
});

async function loginWithCredentials(username, password, errorEl) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed';
      return;
    }

    localStorage.setItem('geosync_token', data.token);
    localStorage.setItem('geosync_username', username);
    showRoomScreen(username);
  } catch {
    errorEl.textContent = 'Network error — is the server running?';
  }
}

// ── Room screen ───────────────────────────────────────────────────────────────
function showRoomScreen(username) {
  welcomeUsername.textContent = username;
  roomCodeDisplay.style.display = 'none';
  roomError.textContent = '';
  setScreen('room');
}

createRoomBtn.addEventListener('click', () => {
  // Generate a 6-char room code client-side using crypto for randomness.
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 36])
    .join('');
  generatedCodeEl.textContent = code;
  roomCodeDisplay.style.display = 'block';
});

enterCreatedRoomBtn.addEventListener('click', () => {
  const code = generatedCodeEl.textContent.trim();
  if (code) enterRoom(code);
});

joinRoomBtn.addEventListener('click', () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    roomError.textContent = 'Enter a valid 6-character room code.';
    return;
  }
  roomError.textContent = '';
  enterRoom(code);
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('geosync_token');
  localStorage.removeItem('geosync_username');
  if (socket) { socket.disconnect(); socket = null; }
  setScreen('auth');
});

// ── Map + Socket ──────────────────────────────────────────────────────────────
function enterRoom(roomCode) {
  const token = localStorage.getItem('geosync_token');
  if (!token) { setScreen('auth'); return; }

  currentRoomCode = roomCode;
  activeRoomCodeEl.textContent = roomCode;
  setScreen('map');

  // Initialise Leaflet map once.
  if (!map) {
    map = L.map('map').setView(INDIA_CENTER, INITIAL_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }

  // Connect socket with JWT — rejected server-side if token is invalid/expired.
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    socket.emit('join-room', { roomCode });
    startGPS();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
    if (err.message.includes('Authentication')) {
      // Token expired or invalid — force re-login.
      localStorage.removeItem('geosync_token');
      localStorage.removeItem('geosync_username');
      setScreen('auth');
    }
  });

  socket.on('user-joined', ({ username }) => {
    showToast(`${username} joined the room`);
  });

  socket.on('user-left', ({ username, id }) => {
    showToast(`${username} left the room`);
    if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
    removeUserFromSidebar(id);
  });

  socket.on('receive-location', ({ id, userId, lat, lng, username }) => {
    // Remember the DB userId for this socket so we can request route history.
    socketUserIds[id] = userId;

    if (markers[id]) {
      markers[id].setLatLng([lat, lng]);
    } else {
      markers[id] = L.marker([lat, lng]).addTo(map).bindPopup(username);
      addUserToSidebar(id, username);
    }

    // Centre map on own first fix.
    if (id === socket.id && !hasCenteredOnSelf) {
      map.setView([lat, lng], 16);
      hasCenteredOnSelf = true;
    }
  });
}

// ── Route history ─────────────────────────────────────────────────────────────
// Fetch a user's recent path and draw it as a dashed polyline. Only one route
// is shown at a time — requesting a new one replaces the previous.
async function showRouteHistory(socketId, username) {
  const userId = socketUserIds[socketId];
  if (!userId) { showToast('No history available yet for this user.'); return; }

  const token = localStorage.getItem('geosync_token');
  try {
    const res = await fetch(`/api/history/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { showToast('Could not load route history.'); return; }

    const feature = await res.json();
    if (!feature.geometry) {
      showToast(`No route yet for ${username} — need at least two pings.`);
      return;
    }

    clearRoute();
    routeLayer = L.geoJSON(feature, {
      style: { color: '#4f46e5', weight: 4, opacity: 0.8, dashArray: '8 6' },
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    clearRouteBtn.style.display = 'block';
    showToast(`Showing ${username}'s route`);
  } catch {
    showToast('Network error loading route history.');
  }
}

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  clearRouteBtn.style.display = 'none';
}

function startGPS() {
  if (!('geolocation' in navigator)) {
    showToast('Geolocation is not supported by this browser.');
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      if (socket && socket.connected) {
        socket.emit('send-location', { lat: latitude, lng: longitude });
      }
    },
    (error) => {
      console.error('Geolocation error:', error);
      showToast(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission denied — enable it to share your position.'
          : 'Could not read your location.'
      );
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}

// ── Boot: check for existing valid token ──────────────────────────────────────
(function boot() {
  const token = localStorage.getItem('geosync_token');
  const username = localStorage.getItem('geosync_username');

  if (!token || !username) {
    setScreen('auth');
    return;
  }

  // Decode expiry without a library — jwt payload is base64url encoded.
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) {
      // Token expired — clear and show login.
      localStorage.removeItem('geosync_token');
      localStorage.removeItem('geosync_username');
      setScreen('auth');
      return;
    }
  } catch {
    setScreen('auth');
    return;
  }

  // Valid token — skip login and go straight to room selection.
  showRoomScreen(username);
})();
