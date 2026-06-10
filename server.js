// GeoSync entry point — wires the Express app and Socket.IO together.
// Phase 2: real-time location sharing. The users object and socket handlers
// live here for now; they move to src/socket/ in Phase 3 when rooms and auth
// are introduced (per the phase plan in TO-DO.md).

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();

// Socket.IO needs a raw HTTP server to attach to, so we create one explicitly
// and hand the Express app to it as the request listener.
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve everything in /public as static assets (index.html, style.css, app.js).
app.use(express.static(path.join(__dirname, 'public')));

// In-memory map of connected sockets: socket.id -> { lat, lng }.
// Phase 2 is global (no rooms); Phase 3 adds username + roomCode and scopes
// broadcasts with io.to(roomCode).emit().
const users = {};

io.on('connection', (socket) => {
  console.log(`socket connected: ${socket.id}`);

  // A client reports its current GPS position.
  socket.on('send-location', (data) => {
    const { lat, lng } = data;
    users[socket.id] = { lat, lng };
    // Global broadcast for Phase 2 — replaced by io.to(roomCode) in Phase 3.
    io.emit('receive-location', { id: socket.id, lat, lng });
  });

  // Clean up shared state on disconnect so the users object never leaks.
  socket.on('disconnect', () => {
    console.log(`socket disconnected: ${socket.id}`);
    delete users[socket.id];
    io.emit('user-disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`GeoSync server running at http://localhost:${PORT}`);
});
