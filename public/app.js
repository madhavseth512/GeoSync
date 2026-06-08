// GeoSync client — Phase 1: render a static, interactive map only.
// Real-time location, GPS reading, and markers are added in Phase 2.

// Centre on India [lat, lng] at a country-level zoom.
const INDIA_CENTER = [20.5937, 78.9629];
const INITIAL_ZOOM = 5;

const map = L.map('map').setView(INDIA_CENTER, INITIAL_ZOOM);

// OpenStreetMap tiles — free, no API key required (see TECH-STACK.md).
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
