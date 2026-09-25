'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function markdownToHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, slug, category, excerpt, published_at
       FROM stories WHERE published_at <= now()
       ORDER BY published_at DESC`
    );
    res.render('stories/index', {
      title: 'Stories — Velvet',
      bodyClass: 'stories-page',
      stories: result.rows,
    });
  } catch (e) {
    res.render('stories/index', { title: 'Stories — Velvet', bodyClass: 'stories-page', stories: [] });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM stories WHERE slug = $1 AND published_at <= now()`,
      [req.params.slug]
    );
    if (!result.rows.length) return res.status(404).render('error', { title: 'Not found', message: 'Story not found.' });
    const story = result.rows[0];
    story.body_html = markdownToHtml(story.body);
    res.render('stories/show', {
      title: `${story.title} — Velvet`,
      description: story.excerpt,
      bodyClass: 'story-page',
      story,
    });
  } catch (e) {
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

module.exports = router;
module.exports.slugify = slugify;
