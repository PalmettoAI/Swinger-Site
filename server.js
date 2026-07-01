'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const expressLayouts = require('express-ejs-layouts');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { pool } = require('./db/pool');
const { migrate } = require('./db/migrate');
const { loadUser } = require('./middleware/auth');
const helpers = require('./lib/helpers');

const app = express();
app.set('trust proxy', 1);

// ── Views ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// ── Security headers (relaxed CSP so inline theme + uploads work) ─────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ── Body parsing & static ────────────────────────────────────────────
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(config.uploads.dir, { maxAge: '30d' }));

// ── Sessions ─────────────────────────────────────────────────────────
app.use(
  session({
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    name: 'velvet.sid',
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.session.maxAge,
    },
  })
);

// ── Locals available to every template ───────────────────────────────
app.use((req, res, next) => {
  res.locals.brand = config.brand;
  res.locals.tiers = config.membership.tiers;
  res.locals.h = helpers;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.flash = req.session ? req.session.flash : null;
  res.locals.title = config.brand.name;
  res.locals.metaDescription = `${config.brand.name} — ${config.brand.tagline}`;
  res.locals.bodyClass = '';
  if (req.session) delete req.session.flash;
  next();
});

// Simple flash helper
app.use((req, res, next) => {
  req.flash = (type, message) => {
    req.session.flash = { type, message };
  };
  next();
});

app.use(loadUser);

// ── Rate limiting on auth endpoints ──────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

// ── Routes ───────────────────────────────────────────────────────────
app.use('/', require('./routes/pages'));
app.use('/', authLimiter, require('./routes/auth'));
app.use('/onboarding', require('./routes/onboarding'));
app.use('/browse', require('./routes/browse'));
app.use('/matches', require('./routes/matches'));
app.use('/messages', require('./routes/messages'));
app.use('/events', require('./routes/events'));
app.use('/membership', require('./routes/membership'));
app.use('/photos', require('./routes/photos'));
app.use('/profile', require('./routes/profile'));

// ── 404 ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: "This page slipped away. Let's get you back.",
    bodyClass: 'page-narrow',
  });
});

// ── Error handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).render('error', {
    title: 'Something went wrong',
    message: config.isProd ? 'Something went wrong on our end.' : err.message,
    bodyClass: 'page-narrow',
  });
});

// ── Boot ─────────────────────────────────────────────────────────────
async function boot() {
  try {
    if (config.db.url) {
      await migrate();
      if (config.seed.enabled) {
        const { seed } = require('./db/seed');
        await seed();
      }
    } else {
      console.warn('[boot] Running without a database — most features will be unavailable.');
    }
  } catch (err) {
    console.error('[boot] startup migration error:', err.message);
  }
  app.listen(config.port, () => {
    console.log(`[${config.brand.name}] listening on :${config.port} (${config.env})`);
  });
}

boot();

module.exports = app;
