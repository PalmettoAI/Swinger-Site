'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { requireAge } = require('../middleware/auth');
const { ACCOUNT_TYPES } = require('../lib/helpers');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Signup ───────────────────────────────────────────────────────────
router.get('/signup', requireAge, (req, res) => {
  if (req.user) return res.redirect('/browse');
  res.render('auth/signup', {
    title: 'Create your account',
    bodyClass: 'auth-page',
    accountTypes: ACCOUNT_TYPES,
    values: {},
    error: null,
  });
});

router.post('/signup', requireAge, async (req, res) => {
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
    });

  if (!EMAIL_RE.test(email)) return fail('Please enter a valid email address.');
  if (password.length < 8) return fail('Password must be at least 8 characters.');
  if (!ACCOUNT_TYPES[accountType]) return fail('Please choose an account type.');
  if (req.body.age_confirm !== 'on') return fail('You must confirm you are 18 or older.');

  const emailNorm = email.toLowerCase();
  try {
    const exists = await db.query('SELECT 1 FROM users WHERE email_norm = $1', [emailNorm]);
    if (exists.rowCount) return fail('An account with that email already exists.');

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (email, email_norm, password_hash, account_type, age_verified)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [email, emailNorm, hash, accountType]
    );
    req.session.userId = rows[0].id;
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
