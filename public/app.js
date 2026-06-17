// GeoSync client — Phase 7: geofencing (Draw on Map + Walk Boundary).

const INDIA_CENTER = [20.5937, 78.9629];
const INITIAL_ZOOM = 5;
const WALK_MIN_DISTANCE_M = 5; // minimum metres between waypoints to filter GPS drift

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

// Draw mode toggle
const modeMapDrawBtn      = document.getElementById('mode-map-draw');
const modeWalkBoundaryBtn = document.getElementById('mode-walk-boundary');
const drawModeToggle      = document.getElementById('draw-mode-toggle');

// Walk Boundary controls
const walkControls   = document.getElementById('walk-controls');
const walkStartBtn   = document.getElementById('walk-start-btn');
const walkCounter    = document.getElementById('walk-counter');
const walkPointCount = document.getElementById('walk-point-count');
const walkUndoBtn    = document.getElementById('walk-undo-btn');
const walkSaveBtn    = document.getElementById('walk-save-btn');
const walkCancelBtn  = document.getElementById('walk-cancel-btn');

// Alert panel
const alertPanel = document.getElementById('alert-panel');
const alertList  = document.getElementById('alert-list');

// Zone name modal
const zoneModal       = document.getElementById('zone-modal');
const zoneNameInput   = document.getElementById('zone-name-input');
const zoneSaveBtn     = document.getElementById('zone-save-btn');
const zoneCancelBtn   = document.getElementById('zone-cancel-btn');

// View mode toggle + heatmap controls
const viewLiveBtn      = document.getElementById('view-live');
const viewHeatmapBtn   = document.getElementById('view-heatmap');
const heatmapControls  = document.getElementById('heatmap-controls');
const heatmapRangeSel  = document.getElementById('heatmap-range');
const heatmapSpinner   = document.getElementById('heatmap-spinner');

clearRouteBtn.addEventListener('click', clearRoute);

// ── State ─────────────────────────────────────────────────────────────────────
let socket        = null;
let map           = null;
const markers     = {};  // socket.id -> Leaflet marker
const roomUsers   = {};  // socket.id -> username
const socketUserIds = {}; // socket.id -> database userId (for history lookups)
let hasCenteredOnSelf = false;
let currentRoomCode   = null;
let routeLayer        = null;

// Geofence state
let drawnItems        = null;  // L.FeatureGroup holding all drawn zone layers
let drawControl       = null;  // Leaflet.draw toolbar instance
let pendingLayer      = null;  // layer waiting for name input (map-draw mode)
const geofenceLayers  = {};    // geofenceId -> Leaflet layer (for delete)
const alerts          = [];    // last 10 { username, zoneName, type, timestamp }

// Heatmap state
let viewMode          = 'live'; // 'live' | 'heatmap'
let heatLayer         = null;   // L.heatLayer instance
let heatmapTimer      = null;   // auto-refresh interval id

// Walk Boundary state
let walkWaypoints     = [];    // [{ lat, lng }] collected so far
let walkPolyline      = null;  // live L.polyline shown during recording
let walkPreview       = null;  // closed polygon preview before saving
let walkGpsWatchId    = null;  // navigator.geolocation watchPosition id
let isRecording       = false;

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

// Haversine distance in metres between two lat/lng points.
// Used to filter GPS drift during Walk Boundary recording.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
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
  // Stop the heatmap auto-refresh timer so it doesn't keep firing after logout.
  if (heatmapTimer) { clearInterval(heatmapTimer); heatmapTimer = null; }
  setScreen('auth');
});

// ── Map + Socket ──────────────────────────────────────────────────────────────
function enterRoom(roomCode) {
  const token = localStorage.getItem('geosync_token');
  if (!token) { setScreen('auth'); return; }

  currentRoomCode = roomCode;
  activeRoomCodeEl.textContent = roomCode;
  setScreen('map');

  if (!map) {
    map = L.map('map').setView(INDIA_CENTER, INITIAL_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    initDrawTools();
  }

  loadGeofences(roomCode);

  socket = io({ auth: { token } });

  socket.on('connect', () => {
    socket.emit('join-room', { roomCode });
    startGPS();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
    if (err.message.includes('Authentication')) {
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
    socketUserIds[id] = userId;

    if (markers[id]) {
      markers[id].setLatLng([lat, lng]);
    } else {
      markers[id] = L.marker([lat, lng]).bindPopup(username);
      // Only show live markers in Live mode — heatmap mode keeps the map clean.
      if (viewMode === 'live') markers[id].addTo(map);
      addUserToSidebar(id, username);
    }

    if (id === socket.id && !hasCenteredOnSelf) {
      map.setView([lat, lng], 16);
      hasCenteredOnSelf = true;
    }
  });

  socket.on('geofence-alert', ({ geofenceId, username, zoneName, type, timestamp }) => {
    const verb = type === 'enter' ? 'entered' : 'left';
    showToast(`${username} ${verb} ${zoneName}`);
    addAlert({ geofenceId, username, zoneName, type, timestamp });
  });

  // Another room member deleted a zone — remove it from our map live.
  socket.on('geofence-removed', ({ id }) => {
    removeGeofenceLocally(id);
  });
}

// ── Route history ─────────────────────────────────────────────────────────────
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
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  clearRouteBtn.style.display = 'none';
}

// ── GPS ───────────────────────────────────────────────────────────────────────
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

// ── Geofence: load existing zones on room join ────────────────────────────────
async function loadGeofences(roomCode) {
  const token = localStorage.getItem('geosync_token');
  try {
    const res = await fetch(`/api/geofences/${roomCode}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const fences = await res.json();
    fences.forEach(fence => renderGeofenceLayer(fence.id, fence.name, fence.geometry));
  } catch (err) {
    console.error('loadGeofences failed:', err.message);
  }
}

// Returns [lat, lng] of the northernmost vertex of a GeoJSON Polygon.
// Used to anchor the zone label on the boundary rather than the centroid,
// so nested or overlapping zones each have clearly separated labels.
function getTopmostLatLng(geometry) {
  const ring = geometry.coordinates[0]; // outer ring — [[lng, lat], ...]
  let top = ring[0];
  for (const coord of ring) { if (coord[1] > top[1]) top = coord; }
  return [top[1], top[0]]; // Leaflet expects [lat, lng]
}

// Render a saved geofence polygon onto the map.
function renderGeofenceLayer(id, name, geometry) {
  const layer = L.geoJSON({ type: 'Feature', geometry }, {
    style: { color: '#f59e0b', weight: 2, fillOpacity: 0.15, fillColor: '#f59e0b' },
  }).addTo(map);

  // Pin the label to the northernmost vertex so it sits on the polygon edge.
  // A divIcon marker is used instead of bindTooltip so we control exact position.
  const labelPos = getTopmostLatLng(geometry);
  const label = L.marker(labelPos, {
    icon: L.divIcon({
      className: 'zone-label',
      html: `<span>${name}</span>`,
      iconSize: null,       // let CSS control size
      iconAnchor: [0, 18],  // shift up so label sits above the vertex dot
    }),
    interactive: false,     // labels don't capture mouse events
    zIndexOffset: 500,
  }).addTo(map);

  layer._geofenceId = id;
  layer._label = label;     // store so we can remove it with the zone
  geofenceLayers[id] = layer;
  layer.eachLayer(l => { l._geofenceId = id; drawnItems.addLayer(l); });
}

// Remove a zone from this client's map entirely — polygon, label, and its
// alerts. Idempotent (guards on existence) so it's safe whether triggered by the
// local delete tool or by a 'geofence-removed' broadcast from another client.
function removeGeofenceLocally(id) {
  const layer = geofenceLayers[id];
  if (layer) {
    if (layer._label) map.removeLayer(layer._label);
    layer.eachLayer(l => { if (drawnItems.hasLayer(l)) drawnItems.removeLayer(l); });
    if (map.hasLayer(layer)) map.removeLayer(layer);
    delete geofenceLayers[id];
  }
  removeAlertsForGeofence(id);
}

// ── Geofence: Draw on Map (Leaflet.draw) ──────────────────────────────────────
function initDrawTools() {
  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  drawControl = new L.Control.Draw({
    draw: {
      polygon:      { shapeOptions: { color: '#f59e0b', fillOpacity: 0.15 } },
      rectangle:    { shapeOptions: { color: '#f59e0b', fillOpacity: 0.15 } },
      polyline:     false,
      circle:       false,
      circlemarker: false,
      marker:       false,
    },
    edit: {
      featureGroup: drawnItems,
      remove:       true,
    },
  });
  // Draw toolbar only shown in "Draw on Map" mode (added/removed on toggle).
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    pendingLayer = e.layer;
    // Show the drawn shape immediately as a preview; name modal confirms it.
    drawnItems.addLayer(pendingLayer);
    openZoneModal(() => {
      // On cancel: remove the preview layer.
      drawnItems.removeLayer(pendingLayer);
      pendingLayer = null;
    });
  });

  map.on(L.Draw.Event.DELETED, (e) => {
    e.layers.eachLayer(layer => {
      const id = layer._geofenceId;
      if (!id) return;

      // Remove locally right away, then persist to the DB + notify the room.
      removeGeofenceLocally(id);
      deleteGeofenceFromServer(id);
    });
  });
}

// ── Geofence: Zone name modal ─────────────────────────────────────────────────
// onCancel is called if the user dismisses without saving.
function openZoneModal(onCancel) {
  zoneNameInput.value = '';
  zoneModal.classList.remove('hidden');
  zoneNameInput.focus();

  function cleanup() {
    zoneModal.classList.add('hidden');
    zoneSaveBtn.removeEventListener('click', handleSave);
    zoneCancelBtn.removeEventListener('click', handleCancel);
    zoneNameInput.removeEventListener('keydown', handleKey);
  }

  function handleSave() {
    const name = zoneNameInput.value.trim();
    if (!name) { zoneNameInput.focus(); return; }
    cleanup();
    saveZoneWithName(name);
  }

  function handleCancel() {
    cleanup();
    if (onCancel) onCancel();
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') handleCancel();
  }

  zoneSaveBtn.addEventListener('click', handleSave);
  zoneCancelBtn.addEventListener('click', handleCancel);
  zoneNameInput.addEventListener('keydown', handleKey);
}

// Called with a confirmed name — determines whether we're saving a map-drawn
// polygon (pendingLayer) or a walk-boundary polygon (walkPreview).
async function saveZoneWithName(name) {
  let geojsonPolygon;
  let layerToKeep;

  if (pendingLayer) {
    // Map-draw mode: pendingLayer is already a Leaflet layer on drawnItems.
    geojsonPolygon = pendingLayer.toGeoJSON().geometry;
    layerToKeep = pendingLayer;
    pendingLayer = null;
  } else if (walkPreview) {
    // Walk Boundary mode: walkPreview is the closed polygon layer.
    geojsonPolygon = walkPreview.toGeoJSON().geometry;
    layerToKeep = null; // we'll re-render via renderGeofenceLayer after save
    map.removeLayer(walkPreview);
    walkPreview = null;
  } else {
    return;
  }

  const token = localStorage.getItem('geosync_token');
  try {
    const res = await fetch('/api/geofences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode: currentRoomCode, name, polygon: geojsonPolygon }),
    });
    if (!res.ok) { showToast('Failed to save zone.'); return; }
    const saved = await res.json();

    // Remove the temporary preview layer and replace with the styled zone layer.
    if (layerToKeep) drawnItems.removeLayer(layerToKeep);
    renderGeofenceLayer(saved.id, name, geojsonPolygon);
    showToast(`Zone "${name}" saved`);
  } catch {
    showToast('Network error saving zone.');
  }
}

async function deleteGeofenceFromServer(id) {
  const token = localStorage.getItem('geosync_token');
  try {
    // REST DELETE is the source of truth — authenticated, removes the DB row.
    await fetch(`/api/geofences/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ roomCode: currentRoomCode }),
    });
    // Notify other room members so the zone vanishes from their maps live too.
    if (socket && socket.connected) socket.emit('delete-geofence', { id });
  } catch (err) {
    console.error('deleteGeofence server call failed:', err.message);
  }
}

// ── Geofence: Walk Boundary mode ──────────────────────────────────────────────
modeMapDrawBtn.addEventListener('click', () => {
  if (isRecording) cancelWalkRecording();
  modeMapDrawBtn.classList.add('active');
  modeWalkBoundaryBtn.classList.remove('active');
  walkControls.classList.add('hidden');
  if (drawControl && map) map.addControl(drawControl);
});

modeWalkBoundaryBtn.addEventListener('click', () => {
  modeWalkBoundaryBtn.classList.add('active');
  modeMapDrawBtn.classList.remove('active');
  walkControls.classList.remove('hidden');
  // Hide draw toolbar — user is walking, not clicking.
  if (drawControl && map) map.removeControl(drawControl);
});

walkStartBtn.addEventListener('click', startWalkRecording);
walkUndoBtn.addEventListener('click', undoWalkPoint);
walkSaveBtn.addEventListener('click', () => {
  if (walkWaypoints.length < 3) return;
  stopWalkRecording();
  // Build closed GeoJSON polygon from waypoints.
  const coords = walkWaypoints.map(p => [p.lng, p.lat]);
  coords.push(coords[0]); // close the ring
  const polygon = { type: 'Polygon', coordinates: [coords] };

  // Show a preview of the closed polygon before the name prompt.
  walkPreview = L.polygon(walkWaypoints.map(p => [p.lat, p.lng]), {
    color: '#f59e0b', fillOpacity: 0.2,
  }).addTo(map);

  openZoneModal(() => {
    // Cancelled — remove preview and reset.
    if (walkPreview) { map.removeLayer(walkPreview); walkPreview = null; }
  });

  // Stash the GeoJSON on walkPreview so saveZoneWithName can access it.
  if (walkPreview) walkPreview.toGeoJSON = () => ({ geometry: polygon });

  resetWalkUI();
});

walkCancelBtn.addEventListener('click', cancelWalkRecording);

function startWalkRecording() {
  if (!('geolocation' in navigator)) {
    showToast('Geolocation not supported.');
    return;
  }
  isRecording = true;
  walkWaypoints = [];
  if (walkPolyline) { map.removeLayer(walkPolyline); walkPolyline = null; }

  walkStartBtn.classList.add('hidden');
  walkCounter.classList.remove('hidden');
  walkUndoBtn.classList.remove('hidden');
  walkSaveBtn.classList.remove('hidden');
  walkCancelBtn.classList.remove('hidden');
  updateWalkCounter();

  walkGpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!isRecording) return;
      const { latitude: lat, longitude: lng } = pos.coords;
      const last = walkWaypoints[walkWaypoints.length - 1];
      // Only add point if far enough from the previous one (filters GPS drift).
      if (last && haversineMeters(last.lat, last.lng, lat, lng) < WALK_MIN_DISTANCE_M) return;
      walkWaypoints.push({ lat, lng });
      updateWalkPolyline();
      updateWalkCounter();
    },
    (err) => { console.error('Walk GPS error:', err.message); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function stopWalkRecording() {
  isRecording = false;
  if (walkGpsWatchId !== null) {
    navigator.geolocation.clearWatch(walkGpsWatchId);
    walkGpsWatchId = null;
  }
  if (walkPolyline) { map.removeLayer(walkPolyline); walkPolyline = null; }
}

function cancelWalkRecording() {
  stopWalkRecording();
  walkWaypoints = [];
  if (walkPolyline) { map.removeLayer(walkPolyline); walkPolyline = null; }
  resetWalkUI();
}

function resetWalkUI() {
  walkStartBtn.classList.remove('hidden');
  walkCounter.classList.add('hidden');
  walkUndoBtn.classList.add('hidden');
  walkSaveBtn.classList.add('hidden');
  walkCancelBtn.classList.add('hidden');
  walkSaveBtn.disabled = true;
  walkPointCount.textContent = '0';
}

function undoWalkPoint() {
  if (walkWaypoints.length === 0) return;
  walkWaypoints.pop();
  updateWalkPolyline();
  updateWalkCounter();
}

function updateWalkPolyline() {
  const latLngs = walkWaypoints.map(p => [p.lat, p.lng]);
  if (walkPolyline) {
    walkPolyline.setLatLngs(latLngs);
  } else {
    walkPolyline = L.polyline(latLngs, { color: '#f59e0b', weight: 3, dashArray: '6 4' }).addTo(map);
  }
}

function updateWalkCounter() {
  walkPointCount.textContent = walkWaypoints.length;
  walkSaveBtn.disabled = walkWaypoints.length < 3;
}

// ── Geofence: Alert history ───────────────────────────────────────────────────
function addAlert({ geofenceId, username, zoneName, type, timestamp }) {
  alerts.unshift({ geofenceId, username, zoneName, type, timestamp });
  if (alerts.length > 10) alerts.pop();
  renderAlerts();
}

// Drop all alerts belonging to a deleted zone so the panel stays in sync with
// the map. Alerts are tagged with geofenceId for exactly this reason.
function removeAlertsForGeofence(id) {
  for (let i = alerts.length - 1; i >= 0; i--) {
    if (alerts[i].geofenceId === id) alerts.splice(i, 1);
  }
  renderAlerts();
}

function renderAlerts() {
  alertPanel.classList.toggle('hidden', alerts.length === 0);
  alertList.innerHTML = '';
  alerts.forEach(a => {
    const li = document.createElement('li');
    const time = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const verb = a.type === 'enter' ? 'entered' : 'left';
    li.innerHTML = `<span class="alert-dot ${a.type}">●</span>${a.username} ${verb} <strong>${a.zoneName}</strong><span class="alert-time">${time}</span>`;
    alertList.appendChild(li);
  });
}

// ── Heatmap mode ──────────────────────────────────────────────────────────────
const HEATMAP_REFRESH_MS = 60 * 1000; // auto-refresh cadence while in heatmap mode

viewLiveBtn.addEventListener('click', () => setViewMode('live'));
viewHeatmapBtn.addEventListener('click', () => setViewMode('heatmap'));
heatmapRangeSel.addEventListener('change', loadHeatmap);

function setViewMode(mode) {
  if (mode === viewMode) return;
  viewMode = mode;

  viewLiveBtn.classList.toggle('active', mode === 'live');
  viewHeatmapBtn.classList.toggle('active', mode === 'heatmap');

  if (mode === 'heatmap') {
    enterHeatmapMode();
  } else {
    enterLiveMode();
  }
}

function enterHeatmapMode() {
  // Cancel any in-progress walk recording — drawing makes no sense in heatmap view.
  if (isRecording) cancelWalkRecording();

  // Hide live-mode controls + the draw toolbar.
  drawModeToggle.classList.add('hidden');
  walkControls.classList.add('hidden');
  if (drawControl && map) map.removeControl(drawControl);

  // Hide live markers and any displayed route polyline.
  Object.values(markers).forEach(m => { if (map.hasLayer(m)) map.removeLayer(m); });
  clearRoute();

  // Show heatmap controls and load the layer.
  heatmapControls.classList.remove('hidden');
  loadHeatmap();
  heatmapTimer = setInterval(loadHeatmap, HEATMAP_REFRESH_MS);
}

function enterLiveMode() {
  // Stop auto-refresh and remove the heat layer.
  if (heatmapTimer) { clearInterval(heatmapTimer); heatmapTimer = null; }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  heatmapControls.classList.add('hidden');

  // Restore live markers.
  Object.values(markers).forEach(m => { if (!map.hasLayer(m)) m.addTo(map); });

  // Restore the draw toolbar only if Draw on Map is the active sub-mode.
  drawModeToggle.classList.remove('hidden');
  if (modeMapDrawBtn.classList.contains('active') && drawControl && map) {
    map.addControl(drawControl);
  }
}

async function loadHeatmap() {
  if (!currentRoomCode) return;
  const hours = Number(heatmapRangeSel.value);
  const from = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  const token = localStorage.getItem('geosync_token');
  heatmapSpinner.classList.remove('hidden');
  try {
    const res = await fetch(`/api/heatmap/${currentRoomCode}?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { showToast('Could not load heatmap.'); return; }
    const { points } = await res.json();
    renderHeat(points);
  } catch {
    showToast('Network error loading heatmap.');
  } finally {
    heatmapSpinner.classList.add('hidden');
  }
}

function renderHeat(points) {
  // A stale fetch could resolve after the user switched back to Live — ignore it.
  if (viewMode !== 'heatmap') return;

  if (!points || points.length === 0) {
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    showToast('No location history in this range yet.');
    return;
  }

  // Leaflet.heat takes [lat, lng, intensity]. Normalise weight to [0,1] against
  // the densest cell so the gradient scales to whatever data the room has.
  const maxWeight = points.reduce((m, p) => Math.max(m, p.weight), 0);
  const heatPoints = points.map(p => [p.lat, p.lng, p.weight / maxWeight]);

  if (heatLayer) {
    heatLayer.setLatLngs(heatPoints);
  } else {
    heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      gradient: { 0.0: 'blue', 0.5: 'lime', 0.7: 'yellow', 1.0: 'red' },
    }).addTo(map);
  }
}

// ── Boot: check for existing valid token ──────────────────────────────────────
(function boot() {
  const token = localStorage.getItem('geosync_token');
  const username = localStorage.getItem('geosync_username');

  if (!token || !username) { setScreen('auth'); return; }

  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('geosync_token');
      localStorage.removeItem('geosync_username');
      setScreen('auth');
      return;
    }
  } catch {
    setScreen('auth');
    return;
  }

  showRoomScreen(username);
})();
