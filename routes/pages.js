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
  let foundingSpots = null;
  try {
    if (config.db.url) {
      const q = await db.query(`
        SELECT
          (SELECT count(*) FROM users WHERE is_active) AS members,
          (SELECT count(DISTINCT (city || state)) FROM profiles WHERE city IS NOT NULL) AS cities,
          (SELECT count(*) FROM events WHERE starts_at > now()) AS events
      `);
      stats = q.rows[0];
      if (config.founding.enabled) {
        foundingSpots = Math.max(0, config.founding.limit - parseInt(stats.members, 10));
      }
    }
  } catch (_) { /* landing still renders without stats */ }

  res.render('landing', {
    title: `${config.brand.name} — ${config.brand.tagline}`,
    layout: 'layout',
    bodyClass: 'landing',
    robots: 'index, follow',
    stats,
    foundingSpots,
    foundingMonths: config.founding.goldMonths,
    foundingLimit: config.founding.limit,
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
  res.render('about', { title: 'About', bodyClass: 'page-narrow', robots: 'index, follow' })
);
router.get('/safety', (req, res) =>
  res.render('safety', { title: 'Safety & Consent', bodyClass: 'page-narrow', robots: 'index, follow' })
);
router.get('/pricing', (req, res) =>
  res.render('pricing-public', { title: 'Membership', bodyClass: 'page-narrow', robots: 'index, follow' })
);

// ── Contact ──────────────────────────────────────────────────────────
router.get('/contact', (req, res) =>
  res.render('contact', { title: 'Contact', bodyClass: 'page-narrow' })
);

router.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.render('contact', {
      title: 'Contact', bodyClass: 'page-narrow',
      error: 'Please fill in all required fields.',
      form: req.body,
    });
  }
  try {
    await db.query(
      `INSERT INTO contact_submissions (name, email, subject, message)
       VALUES ($1, $2, $3, $4)`,
      [name.trim(), email.trim(), subject || 'General Inquiry', message.trim()]
    );
    res.render('contact', { title: 'Contact', bodyClass: 'page-narrow', success: true });
  } catch (e) {
    res.render('contact', {
      title: 'Contact', bodyClass: 'page-narrow',
      error: 'Something went wrong — please try again.',
      form: req.body,
    });
  }
});

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

// ── Sitemap ──────────────────────────────────────────────────────────
router.get('/sitemap.xml', async (req, res) => {
  const base = config.brand.siteUrl.replace(/\/$/, '');
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/about', priority: '0.8', changefreq: 'monthly' },
    { loc: '/pricing', priority: '0.8', changefreq: 'monthly' },
    { loc: '/safety', priority: '0.6', changefreq: 'monthly' },
    { loc: '/stories', priority: '0.7', changefreq: 'daily' },
    { loc: '/guidelines', priority: '0.5', changefreq: 'monthly' },
  ];

  let storyUrls = [];
  try {
    if (config.db.url) {
      const { rows } = await db.query(
        `SELECT slug, published_at FROM stories WHERE is_published = true ORDER BY published_at DESC LIMIT 200`
      );
      storyUrls = rows.map(r => ({
        loc: `/stories/${r.slug}`,
        priority: '0.6',
        changefreq: 'yearly',
        lastmod: r.published_at ? new Date(r.published_at).toISOString().split('T')[0] : null,
      }));
    }
  } catch (_) {}

  const today = new Date().toISOString().split('T')[0];
  const allUrls = [...staticPages, ...storyUrls];

  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${base}${u.loc}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`);
});

// ── Google Search Console verification ──────────────────────────────
router.get('/googleb6fe53bf01fd2643.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send('google-site-verification: googleb6fe53bf01fd2643.html');
});

// ── robots.txt ───────────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  const base = config.brand.siteUrl.replace(/\/$/, '');
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *
Disallow: /browse
Disallow: /profile
Disallow: /messages
Disallow: /matches
Disallow: /onboarding
Disallow: /admin
Allow: /

Sitemap: ${base}/sitemap.xml
`);
});

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
