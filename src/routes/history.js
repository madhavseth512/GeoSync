const express = require('express');
const { param, query, validationResult } = require('express-validator');
const { getRouteHistory } = require('../db/queries');
const verifyToken = require('../middleware/auth');

const router = express.Router();

const DEFAULT_WINDOW_MS = 30 * 60 * 1000; // last 30 minutes if no range given

// GET /api/history/:userId?from=&to=
// Returns a GeoJSON LineString of the user's path in the time range.
router.get(
  '/history/:userId',
  verifyToken,
  [
    param('userId').isInt({ min: 1 }).withMessage('userId must be a positive integer'),
    query('from').optional().isISO8601().withMessage('from must be an ISO8601 timestamp'),
    query('to').optional().isISO8601().withMessage('to must be an ISO8601 timestamp'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    // Default to the last 30 minutes when the client omits a range.
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - DEFAULT_WINDOW_MS);

    try {
      const line = await getRouteHistory(userId, from.toISOString(), to.toISOString());
      // null = fewer than 2 points; return an empty FeatureCollection-friendly shape.
      res.json({ type: 'Feature', geometry: line, properties: { userId: Number(userId) } });
    } catch (err) {
      console.error('getRouteHistory failed:', { userId, err: err.message });
      res.status(500).json({ error: 'Database error' });
    }
  }
);

module.exports = router;
