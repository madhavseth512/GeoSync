const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { getHeatmapData } = require('../db/queries');
const verifyToken = require('../middleware/auth');

const router = express.Router();

const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000; // last 6 hours if no range given

// GET /api/heatmap/:roomCode?from=&to=
// Returns aggregated density points [{ lat, lng, weight }] for the room.
router.get(
  '/heatmap/:roomCode',
  verifyToken,
  [
    param('roomCode').isString().isLength({ min: 6, max: 6 }).trim(),
    query('from').optional().isISO8601().withMessage('from must be an ISO8601 timestamp'),
    query('to').optional().isISO8601().withMessage('to must be an ISO8601 timestamp'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { roomCode } = req.params;
    // Default to the last 6 hours when the client omits a range.
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - DEFAULT_WINDOW_MS);

    try {
      const points = await getHeatmapData(roomCode, from.toISOString(), to.toISOString());
      res.json({ points });
    } catch (err) {
      console.error('getHeatmapData failed:', { roomCode, err: err.message });
      res.status(500).json({ error: 'Database error' });
    }
  }
);

module.exports = router;
