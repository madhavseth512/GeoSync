const express = require('express');
const { body, validationResult } = require('express-validator');
const verifyToken = require('../middleware/auth');
const { locationLimiter } = require('../middleware/rate-limiter');
const { processLocationPing, isValidCoord } = require('../services/location');

// Router factory — needs `io` so a REST ping can broadcast to the room, exactly
// like a socket ping does.
module.exports = function createLocationRouter(io) {
  const router = express.Router();

  // POST /api/location — location ingest for BACKGROUND tracking.
  //
  // Why REST and not the socket: when the phone is locked or the app is
  // backgrounded, the WebSocket drops. Android's background location task can
  // still fire an HTTP request, so this is the path that keeps tracking alive
  // with the screen off — the whole reason GeoSync is a native app.
  router.post(
    '/location',
    verifyToken,        // must run first — locationLimiter keys off req.user
    locationLimiter,
    [
      body('roomCode').isString().isLength({ min: 6, max: 6 }).trim(),
      body('lat').isFloat({ min: -90, max: 90 }),
      body('lng').isFloat({ min: -180, max: 180 }),
    ],
    (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { roomCode } = req.body;
      const lat = Number(req.body.lat);
      const lng = Number(req.body.lng);
      if (!isValidCoord(lat, lng)) return res.status(400).json({ error: 'Invalid coordinates' });

      // JWT payload is { userId, username } — note: userId, not id.
      const { userId, username } = req.user;

      // Same service the socket path uses — persist, geofence-check, broadcast.
      processLocationPing(io, { userId, username, roomCode, lat, lng });

      // Ack immediately; processing is fire-and-forget so the tracker isn't blocked.
      res.status(202).json({ ok: true });
    }
  );

  return router;
};
