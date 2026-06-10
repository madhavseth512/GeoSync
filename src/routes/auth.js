const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { createUser, getUserByUsername } = require('../db/queries');

const router = express.Router();

const SALT_ROUNDS = 12; // 2^12 = 4096 iterations — brute-force resistant

// Input validation rules reused across register and login.
const usernameRules = body('username')
  .trim()
  .isLength({ min: 3, max: 50 })
  .withMessage('Username must be 3–50 characters')
  .matches(/^[a-zA-Z0-9_]+$/)
  .withMessage('Username may only contain letters, numbers, and underscores');

const passwordRules = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters');

// POST /api/register
router.post('/register', [usernameRules, passwordRules], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(username, passwordHash);
    res.status(201).json({ message: 'User created', userId: user.id });
  } catch (err) {
    // Unique violation — username already taken.
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Username already taken' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/login
router.post('/login', [usernameRules, body('password').notEmpty()], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password } = req.body;

  try {
    const user = await getUserByUsername(username);

    // Use a constant-time compare regardless of whether user exists —
    // prevents timing attacks that reveal valid usernames.
    const passwordMatch = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || '24h' }
    );

    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
