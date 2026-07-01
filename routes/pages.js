'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');

// ── Landing page ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  // If logged in and onboarded, go straight to the app.
  if (req.user && req.user.onboarded) return res.redirect('/browse');

  let stats = { members: 0, cities: 0, events: 0 };
  try {
    if (config.db.url) {
      const q = await db.query(`
        SELECT
          (SELECT count(*) FROM users WHERE is_active) AS members,
          (SELECT count(DISTINCT (city || state)) FROM profiles WHERE city IS NOT NULL) AS cities,
          (SELECT count(*) FROM events WHERE starts_at > now()) AS events
      `);
      stats = q.rows[0];
    }
  } catch (_) { /* landing still renders without stats */ }

  res.render('landing', {
    title: `${config.brand.name} — ${config.brand.tagline}`,
    layout: 'layout',
    bodyClass: 'landing',
    stats,
  });
});

// ── Age gate (18+ splash) ────────────────────────────────────────────
router.get('/enter', (req, res) => {
  if (req.session.ageOk) return res.redirect(req.query.next || '/');
  res.render('age-gate', {
    title: 'Age verification',
    layout: 'layout-bare',
    bodyClass: 'gate',
    next: req.query.next || '/',
  });
});

router.post('/enter', (req, res) => {
  if (req.body.confirm === 'yes') {
    req.session.ageOk = true;
    return res.redirect(req.body.next || '/signup');
  }
  // "No" → send them away.
  return res.redirect('https://www.google.com');
});

// ── Static content pages ─────────────────────────────────────────────
router.get('/about', (req, res) =>
  res.render('about', { title: 'About', bodyClass: 'page-narrow' })
);
router.get('/safety', (req, res) =>
  res.render('safety', { title: 'Safety & Consent', bodyClass: 'page-narrow' })
);
router.get('/pricing', (req, res) =>
  res.render('pricing-public', { title: 'Membership', bodyClass: 'page-narrow' })
);

// ── Legal ────────────────────────────────────────────────────────────
router.get('/terms', (req, res) =>
  res.render('legal/terms', { title: 'Terms of Service', bodyClass: 'page-narrow legal' })
);
router.get('/privacy', (req, res) =>
  res.render('legal/privacy', { title: 'Privacy Policy', bodyClass: 'page-narrow legal' })
);
router.get('/guidelines', (req, res) =>
  res.render('legal/guidelines', { title: 'Community Guidelines', bodyClass: 'page-narrow legal' })
);

// ── Health check (Railway) ───────────────────────────────────────────
router.get('/healthz', async (req, res) => {
  try {
    if (config.db.url) await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
