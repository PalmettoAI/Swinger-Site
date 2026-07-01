'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');
const { requireAuth, requireOnboarded } = require('../middleware/auth');

// Ensure upload dir exists.
try {
  fs.mkdirSync(config.uploads.dir, { recursive: true });
} catch (_) { /* noop */ }

// ── Multer (local disk). Swap for multer-s3 / R2 in production. ───────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 5);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed.'), ok);
  },
});

router.use(requireAuth, requireOnboarded);

// ── Upload ───────────────────────────────────────────────────────────
router.post('/upload', (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) {
      req.flash('error', err.message || 'Upload failed.');
      return res.redirect('/profile/photos');
    }
    if (!req.file) {
      req.flash('error', 'Please choose a photo.');
      return res.redirect('/profile/photos');
    }

    // Enforce per-tier photo limit.
    const limit = req.user.membership === 'gold'
      ? config.membership.goldPhotoLimit
      : config.membership.freePhotoLimit;
    const countRes = await db.query('SELECT count(*)::int AS n FROM photos WHERE user_id = $1', [req.user.id]);
    if (countRes.rows[0].n >= limit) {
      fs.unlink(path.join(config.uploads.dir, req.file.filename), () => {});
      req.flash('error', `You've reached your ${limit}-photo limit. Upgrade to Gold for more.`);
      return res.redirect('/profile/photos');
    }

    const isPrivate = req.body.is_private === 'on';
    const isFirst = countRes.rows[0].n === 0;
    await db.query(
      `INSERT INTO photos (user_id, filename, is_primary, is_private, sort_order)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.user.id, req.file.filename, isFirst && !isPrivate, isPrivate, countRes.rows[0].n]
    );
    req.flash('success', 'Photo added.');
    res.redirect('/profile/photos');
  });
});

// ── Set primary ──────────────────────────────────────────────────────
router.post('/:id/primary', ownPhoto, async (req, res) => {
  if (req.photo.is_private) {
    req.flash('error', 'Private photos cannot be your primary photo.');
    return res.redirect('/profile/photos');
  }
  await db.withClient(async (client) => {
    await client.query('UPDATE photos SET is_primary = false WHERE user_id = $1', [req.user.id]);
    await client.query('UPDATE photos SET is_primary = true WHERE id = $1', [req.photo.id]);
  });
  res.redirect('/profile/photos');
});

// ── Toggle privacy ───────────────────────────────────────────────────
router.post('/:id/privacy', ownPhoto, async (req, res) => {
  const makePrivate = !req.photo.is_private;
  await db.query(
    'UPDATE photos SET is_private = $1, is_primary = CASE WHEN $1 THEN false ELSE is_primary END WHERE id = $2',
    [makePrivate, req.photo.id]
  );
  res.redirect('/profile/photos');
});

// ── Delete ───────────────────────────────────────────────────────────
router.post('/:id/delete', ownPhoto, async (req, res) => {
  await db.query('DELETE FROM photos WHERE id = $1', [req.photo.id]);
  fs.unlink(path.join(config.uploads.dir, req.photo.filename), () => {});
  res.redirect('/profile/photos');
});

// ── Private gallery access: viewer requests ──────────────────────────
router.post('/access/:ownerId/request', async (req, res) => {
  const owner = req.params.ownerId;
  if (/^[0-9a-f-]{36}$/i.test(owner) && owner !== req.user.id) {
    await db.query(
      `INSERT INTO photo_access (owner_id, viewer_id, status) VALUES ($1,$2,'requested')
         ON CONFLICT (owner_id, viewer_id) DO UPDATE SET status =
           CASE WHEN photo_access.status = 'granted' THEN 'granted' ELSE 'requested' END`,
      [owner, req.user.id]
    );
    req.flash('success', 'Access requested. You\'ll be notified if they approve.');
  }
  res.redirect('/profile/' + owner);
});

// ── Owner grants / denies ────────────────────────────────────────────
router.post('/access/:viewerId/grant', async (req, res) => {
  const viewer = req.params.viewerId;
  if (/^[0-9a-f-]{36}$/i.test(viewer)) {
    await db.query(
      `INSERT INTO photo_access (owner_id, viewer_id, status) VALUES ($1,$2,'granted')
         ON CONFLICT (owner_id, viewer_id) DO UPDATE SET status = 'granted'`,
      [req.user.id, viewer]
    );
    req.flash('success', 'Access granted.');
  }
  res.redirect('/profile/photos');
});

router.post('/access/:viewerId/deny', async (req, res) => {
  const viewer = req.params.viewerId;
  if (/^[0-9a-f-]{36}$/i.test(viewer)) {
    await db.query(
      `UPDATE photo_access SET status = 'denied' WHERE owner_id = $1 AND viewer_id = $2`,
      [req.user.id, viewer]
    );
  }
  res.redirect('/profile/photos');
});

// ── middleware: load a photo the current user owns ──────────────────
async function ownPhoto(req, res, next) {
  const id = req.params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.redirect('/profile/photos');
  const { rows } = await db.query('SELECT * FROM photos WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rows[0]) return res.redirect('/profile/photos');
  req.photo = rows[0];
  next();
}

module.exports = router;
