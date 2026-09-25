'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { requireAge } = require('../middleware/auth');
const { ACCOUNT_TYPES } = require('../lib/helpers');
const config = require('../config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Signup ───────────────────────────────────────────────────────────
router.get('/signup', async (req, res) => {
  if (req.user) return res.redirect('/browse');
  let foundingSpots = null;
  if (config.founding.enabled) {
    try {
      const r = await db.query('SELECT count(*) FROM users WHERE is_active = true');
      const taken = parseInt(r.rows[0].count, 10);
      foundingSpots = Math.max(0, config.founding.limit - taken);
    } catch (_) {}
  }
  res.render('auth/signup', {
    title: 'Create your account',
    bodyClass: 'auth-page',
    accountTypes: ACCOUNT_TYPES,
    values: {},
    error: null,
    foundingSpots,
    foundingMonths: config.founding.goldMonths,
  });
});

router.post('/signup', async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  const accountType = String(req.body.account_type || 'couple');
  const values = { email, account_type: accountType };

  const fail = (error) =>
    res.status(400).render('auth/signup', {
      title: 'Create your account',
      bodyClass: 'auth-page',
      accountTypes: ACCOUNT_TYPES,
      values,
      error,
      foundingSpots: null,
      foundingMonths: config.founding.goldMonths,
    });

  if (!EMAIL_RE.test(email)) return fail('Please enter a valid email address.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (!ACCOUNT_TYPES[accountType]) return fail('Please choose an account type.');
  if (req.body.age_confirm !== 'on') return fail('You must confirm you are 18 or older.');

  const emailNorm = email.toLowerCase();
  try {
    const exists = await db.query('SELECT 1 FROM users WHERE email_norm = $1', [emailNorm]);
    if (exists.rowCount) return fail('An account with that email already exists.');

    // Check founding member eligibility inside a transaction to avoid races
    const hash = await bcrypt.hash(password, 12);
    const userId = await db.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const countRes = await client.query(
          'SELECT count(*) FROM users WHERE is_active = true FOR UPDATE'
        );
        const taken = parseInt(countRes.rows[0].count, 10);
        const isFounder = config.founding.enabled && taken < config.founding.limit;
        const expires = isFounder
          ? new Date(Date.now() + config.founding.goldMonths * 30 * 24 * 60 * 60 * 1000)
          : null;

        const { rows } = await client.query(
          `INSERT INTO users
             (email, email_norm, password_hash, account_type, age_verified,
              membership, membership_since, membership_expires, is_founding_member)
           VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8)
           RETURNING id`,
          [
            email, emailNorm, hash, accountType,
            isFounder ? 'gold' : 'free',
            isFounder ? new Date() : null,
            expires,
            isFounder,
          ]
        );
        await client.query('COMMIT');
        return rows[0].id;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    req.session.userId = userId;
    req.session.ageOk = true;
    return res.redirect('/onboarding');
  } catch (err) {
    console.error('[auth] signup error', err);
    return fail('Something went wrong creating your account. Please try again.');
  }
});

// ── Login ────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/browse');
  res.render('auth/login', {
    title: 'Sign in',
    bodyClass: 'auth-page',
    values: {},
    error: null,
    next: req.query.next || '',
  });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const next = req.body.next || '/browse';

  const fail = () =>
    res.status(401).render('auth/login', {
      title: 'Sign in',
      bodyClass: 'auth-page',
      values: { email: req.body.email },
      error: 'Incorrect email or password.',
      next,
    });

  try {
    const { rows } = await db.query(
      'SELECT id, password_hash, onboarded, is_active FROM users WHERE email_norm = $1',
      [email]
    );
    const user = rows[0];
    if (!user || !user.is_active) return fail();
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return fail();

    req.session.userId = user.id;
    req.session.ageOk = true;
    return res.redirect(user.onboarded ? next : '/onboarding');
  } catch (err) {
    console.error('[auth] login error', err);
    return fail();
  }
});

// ── Logout ───────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
