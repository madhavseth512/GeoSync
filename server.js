// GeoSync entry point — wires the Express app together.
// Per project rules, server.js contains no business logic; it only serves
// the static client and starts the HTTP listener. Real-time, auth, and DB
// wiring are added in later phases.

const express = require('express');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;

// Serve everything in /public as static assets (index.html, style.css, app.js).
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`GeoSync server running at http://localhost:${PORT}`);
});
