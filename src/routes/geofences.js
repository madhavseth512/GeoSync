const express = require('express');
const { body, param, validationResult } = require('express-validator');
const verifyToken = require('../middleware/auth');
const { saveGeofence, getGeofencesForRoom, deleteGeofence } = require('../db/queries');

const router = express.Router();

// Validate that a value is a GeoJSON Polygon with at least 3 exterior ring positions.
function isValidPolygon(value) {
  if (!value || value.type !== 'Polygon' || !Array.isArray(value.coordinates)) return false;
  const ring = value.coordinates[0];
  // A closed ring needs at least 4 positions (3 unique + repeat of first).
  return Array.isArray(ring) && ring.length >= 4;
}

// POST /api/geofences — save a newly drawn zone (map-draw or walk-boundary).
router.post(
  '/geofences',
  verifyToken,
  [
    body('roomCode').isString().isLength({ min: 6, max: 6 }).trim(),
    body('name').isString().isLength({ min: 1, max: 100 }).trim(),
    body('polygon').custom(isValidPolygon).withMessage('polygon must be a valid GeoJSON Polygon with at least 3 points'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { roomCode, name, polygon } = req.body;
    // JWT payload is { userId, username } — req.user.id would be undefined and
    // silently store created_by as NULL.
    const userId = req.user.userId;

    try {
      const geofence = await saveGeofence(roomCode, name, polygon, userId);
      res.status(201).json(geofence);
    } catch (err) {
      console.error('saveGeofence failed:', err.message);
      res.status(500).json({ error: 'Failed to save geofence' });
    }
  }
);

// GET /api/geofences/:roomCode — load all zones for a room (called on room join).
router.get(
  '/geofences/:roomCode',
  verifyToken,
  [param('roomCode').isString().isLength({ min: 6, max: 6 }).trim()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const geofences = await getGeofencesForRoom(req.params.roomCode);
      res.json(geofences);
    } catch (err) {
      console.error('getGeofencesForRoom failed:', err.message);
      res.status(500).json({ error: 'Failed to load geofences' });
    }
  }
);

// DELETE /api/geofences/:id — remove a zone.
// roomCode in body is required — prevents a user in one room from deleting another room's zones.
router.delete(
  '/geofences/:id',
  verifyToken,
  [
    param('id').isInt({ min: 1 }),
    body('roomCode').isString().isLength({ min: 6, max: 6 }).trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      await deleteGeofence(Number(req.params.id), req.body.roomCode);
      res.json({ ok: true });
    } catch (err) {
      console.error('deleteGeofence failed:', err.message);
      res.status(500).json({ error: 'Failed to delete geofence' });
    }
  }
);

module.exports = router;
