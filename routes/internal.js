'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');

// Require X-Internal-Key header matching INTERNAL_API_KEY env var.
// Rejects with 401 if missing or wrong.
function requireInternalKey(req, res, next) {
  const key = config.internalApiKey;
  if (!key || req.headers['x-internal-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// POST /api/internal/stories
// Body: { title, category, excerpt, body, publishedAt? }
router.post('/stories', requireInternalKey, async (req, res) => {
  const { title, category, excerpt, body, publishedAt } = req.body;
  if (!title || !category || !excerpt || !body) {
    return res.status(400).json({ error: 'title, category, excerpt, and body are required' });
  }

  const slug = slugify(title);
  const pubAt = publishedAt ? new Date(publishedAt) : new Date();

  try {
    const { rows } = await db.query(
      `INSERT INTO stories (title, slug, category, excerpt, body, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         excerpt = EXCLUDED.excerpt,
         body = EXCLUDED.body,
         published_at = EXCLUDED.published_at
       RETURNING id, slug`,
      [title, slug, category, excerpt, body, pubAt]
    );
    return res.json({ ok: true, id: rows[0].id, slug: rows[0].slug });
  } catch (err) {
    console.error('[internal] story insert error', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
