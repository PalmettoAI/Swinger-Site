'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth, requireOnboarded } = require('../middleware/auth');

// All forum routes require a logged-in, onboarded member.
router.use(requireAuth, requireOnboarded);

// ── Helpers ───────────────────────────────────────────────────────────────

/** Turn a title into a URL-safe slug, deduped with a short uuid fragment. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function uniqueSlug(text) {
  const base = slugify(text);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base}-${rand}`;
}

// ── GET /forum ─────────────────────────────────────────────────────────────
// List all categories with thread + post counts and latest activity.
router.get('/', async (req, res) => {
  const { rows: categories } = await db.query(`
    SELECT fc.id, fc.slug, fc.name, fc.description, fc.sort_order,
           COUNT(DISTINCT ft.id)::int          AS thread_count,
           COALESCE(SUM(ft.post_count), 0)::int AS post_count,
           MAX(ft.last_post_at)                 AS last_post_at
      FROM forum_categories fc
      LEFT JOIN forum_threads ft ON ft.category_id = fc.id
     GROUP BY fc.id
     ORDER BY fc.sort_order
  `);

  res.render('forum/index', {
    title: 'Community Forum',
    bodyClass: 'forum-page',
    categories,
  });
});

// ── GET /forum/:categorySlug ───────────────────────────────────────────────
// List threads in a category, newest / pinned first.
router.get('/:categorySlug', async (req, res) => {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM forum_categories WHERE slug = $1',
    [req.params.categorySlug]
  );
  if (!cat) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });

  const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 30;
  const offset   = (page - 1) * pageSize;

  const { rows: threads } = await db.query(`
    SELECT ft.id, ft.slug, ft.title, ft.is_pinned, ft.is_locked,
           ft.view_count, ft.post_count, ft.last_post_at, ft.created_at,
           p.display_name AS author_name, u.id AS author_id
      FROM forum_threads ft
      JOIN users u ON u.id = ft.author_id
      JOIN profiles p ON p.user_id = u.id
     WHERE ft.category_id = $1
     ORDER BY ft.is_pinned DESC, ft.last_post_at DESC
     LIMIT $2 OFFSET $3
  `, [cat.id, pageSize + 1, offset]);

  const hasNext = threads.length > pageSize;

  res.render('forum/category', {
    title: cat.name,
    bodyClass: 'forum-page',
    cat,
    threads: threads.slice(0, pageSize),
    page,
    hasNext,
  });
});

// ── GET /forum/:categorySlug/new ───────────────────────────────────────────
// New-thread form.
router.get('/:categorySlug/new', async (req, res) => {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM forum_categories WHERE slug = $1',
    [req.params.categorySlug]
  );
  if (!cat) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });

  res.render('forum/new-thread', {
    title: `New thread — ${cat.name}`,
    bodyClass: 'forum-page forum-compose',
    cat,
    errors: [],
  });
});

// ── POST /forum/:categorySlug/new ──────────────────────────────────────────
// Create a new thread + first post.
router.post('/:categorySlug/new', async (req, res) => {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM forum_categories WHERE slug = $1',
    [req.params.categorySlug]
  );
  if (!cat) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });

  const title = String(req.body.title || '').trim();
  const body  = String(req.body.body  || '').trim();
  const errors = [];
  if (!title || title.length < 3)   errors.push('Title must be at least 3 characters.');
  if (title.length > 200)           errors.push('Title must be 200 characters or fewer.');
  if (!body  || body.length  < 10)  errors.push('Post body must be at least 10 characters.');
  if (body.length > 20000)          errors.push('Post body must be 20,000 characters or fewer.');

  if (errors.length) {
    return res.render('forum/new-thread', {
      title: `New thread — ${cat.name}`,
      bodyClass: 'forum-page forum-compose',
      cat,
      errors,
      formTitle: title,
      formBody: body,
    });
  }

  const slug = uniqueSlug(title);

  const thread = await db.withClient(async (client) => {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query(`
      INSERT INTO forum_threads (category_id, author_id, title, slug, post_count)
      VALUES ($1, $2, $3, $4, 1)
      RETURNING id, slug
    `, [cat.id, req.user.id, title, slug]);
    await client.query(`
      INSERT INTO forum_posts (thread_id, author_id, body)
      VALUES ($1, $2, $3)
    `, [t.id, req.user.id, body]);
    await client.query('COMMIT');
    return t;
  });
  res.redirect(`/forum/${cat.slug}/${thread.slug}`);
});

// ── GET /forum/:categorySlug/:threadSlug ───────────────────────────────────
// Read a thread + all posts.
router.get('/:categorySlug/:threadSlug', async (req, res) => {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM forum_categories WHERE slug = $1',
    [req.params.categorySlug]
  );
  if (!cat) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });

  const { rows: [thread] } = await db.query(
    'SELECT * FROM forum_threads WHERE category_id = $1 AND slug = $2',
    [cat.id, req.params.threadSlug]
  );
  if (!thread) return res.status(404).render('error', { title: 'Not found', message: 'Thread not found.' });

  // Increment view count (fire-and-forget)
  db.query('UPDATE forum_threads SET view_count = view_count + 1 WHERE id = $1', [thread.id]).catch(() => {});

  const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = 20;
  const offset   = (page - 1) * pageSize;

  const { rows: posts } = await db.query(`
    SELECT fp.id, fp.body, fp.created_at, fp.updated_at,
           p.display_name AS author_name, u.id AS author_id,
           u.membership AS author_membership,
           (SELECT filename FROM photos ph WHERE ph.user_id = u.id AND ph.is_private = false
              ORDER BY ph.is_primary DESC, ph.sort_order LIMIT 1) AS author_photo,
           u.account_type AS author_type
      FROM forum_posts fp
      JOIN users u ON u.id = fp.author_id
      JOIN profiles p ON p.user_id = u.id
     WHERE fp.thread_id = $1
     ORDER BY fp.created_at
     LIMIT $2 OFFSET $3
  `, [thread.id, pageSize + 1, offset]);

  const hasNext = posts.length > pageSize;

  res.render('forum/thread', {
    title: thread.title,
    bodyClass: 'forum-page forum-thread',
    cat,
    thread,
    posts: posts.slice(0, pageSize),
    page,
    hasNext,
  });
});

// ── POST /forum/:categorySlug/:threadSlug/reply ────────────────────────────
// Post a reply.
router.post('/:categorySlug/:threadSlug/reply', async (req, res) => {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM forum_categories WHERE slug = $1',
    [req.params.categorySlug]
  );
  const { rows: [thread] } = cat ? await db.query(
    'SELECT * FROM forum_threads WHERE category_id = $1 AND slug = $2',
    [cat.id, req.params.threadSlug]
  ) : { rows: [] };

  if (!cat || !thread) return res.status(404).render('error', { title: 'Not found', message: 'Thread not found.' });
  if (thread.is_locked) {
    req.flash('error', 'This thread is locked.');
    return res.redirect(`/forum/${cat.slug}/${thread.slug}`);
  }

  const body = String(req.body.body || '').trim();
  if (!body || body.length < 2 || body.length > 20000) {
    req.flash('error', 'Reply must be between 2 and 20,000 characters.');
    return res.redirect(`/forum/${cat.slug}/${thread.slug}`);
  }

  await db.query(`
    INSERT INTO forum_posts (thread_id, author_id, body) VALUES ($1, $2, $3)
  `, [thread.id, req.user.id, body]);

  await db.query(`
    UPDATE forum_threads
       SET post_count = post_count + 1, last_post_at = now()
     WHERE id = $1
  `, [thread.id]);

  res.redirect(`/forum/${cat.slug}/${thread.slug}?page=last#bottom`);
});

module.exports = router;
