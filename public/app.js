// GeoSync client — Phase 2: real-time location sharing.
// Reads GPS, emits it to the server, and renders every connected user as a
// live marker. No rooms/auth yet (Phase 3) — every client sees every other.

// Centre on India [lat, lng] at a country-level zoom.
const INDIA_CENTER = [20.5937, 78.9629];
const INITIAL_ZOOM = 5;

const map = L.map('map').setView(INDIA_CENTER, INITIAL_ZOOM);

// OpenStreetMap tiles — free, no API key required (see TECH-STACK.md).
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// Connect to the Socket.IO server (same origin that served this page).
const socket = io();

// Remote (and own) user markers, keyed by socket.id. Per CONVENTIONS.md, always
// check markers[id] before setLatLng() — never assume a marker exists.
const markers = {};

// True until the first GPS fix, so we only auto-centre the map once.
let hasCenteredOnSelf = false;

const userCountEl = document.getElementById('user-count');
const toastEl = document.getElementById('toast');

// Lightweight toast helper — replaces alert()/console for user-facing messages.
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  setTimeout(() => toastEl.classList.remove('visible'), 4000);
}

function updateUserCount() {
  userCountEl.textContent = `Connected: ${Object.keys(markers).length}`;
}

// A location update arrived for some socket (possibly our own echo).
socket.on('receive-location', ({ id, lat, lng }) => {
  if (markers[id]) {
    markers[id].setLatLng([lat, lng]);
  } else {
    // Popup shows the socket ID for now — replaced with username in Phase 3.
    markers[id] = L.marker([lat, lng]).addTo(map).bindPopup(id);
    updateUserCount();
  }

  // Centre on our own position the first time we hear back about ourselves.
  if (id === socket.id && !hasCenteredOnSelf) {
    map.setView([lat, lng], 16);
    hasCenteredOnSelf = true;
  }
});

// A user left — remove their marker and forget them locally.
socket.on('user-disconnected', (id) => {
  if (markers[id]) {
    map.removeLayer(markers[id]);
    delete markers[id];
    updateUserCount();
  }
});

// Start reading GPS. watchPosition fires whenever the device position changes.
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      socket.emit('send-location', { lat: latitude, lng: longitude });
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
} else {
  showToast('Geolocation is not supported by this browser.');
}
