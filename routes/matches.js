'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth, requireOnboarded } = require('../middleware/auth');

router.use(requireAuth, requireOnboarded);

// Ensures a conversation row exists (canonical ordering by uuid) & returns id.
async function ensureConversation(a, b) {
  const [ua, ub] = a < b ? [a, b] : [b, a];
  const { rows } = await db.query(
    `INSERT INTO conversations (user_a, user_b) VALUES ($1,$2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET user_a = EXCLUDED.user_a
       RETURNING id`,
    [ua, ub]
  );
  return rows[0].id;
}

// ── Matches dashboard ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const uid = req.user.id;
  const isGold = req.user.membership === 'gold';

  // Mutual matches
  const { rows: matches } = await db.query(
    `SELECT u.id, p.display_name, p.city, p.state, u.account_type, u.last_active,
            (SELECT filename FROM photos ph WHERE ph.user_id = u.id AND ph.is_private = false
               ORDER BY ph.is_primary DESC LIMIT 1) AS photo
       FROM likes l1
       JOIN likes l2 ON l2.from_user = l1.to_user AND l2.to_user = l1.from_user
       JOIN users u ON u.id = l1.to_user
       JOIN profiles p ON p.user_id = u.id
      WHERE l1.from_user = $1 AND l1.action = 'like' AND l2.action = 'like'
        AND u.is_active = true
      ORDER BY u.last_active DESC`,
    [uid]
  );

  // People who liked you (Gold sees identities; free sees a blurred count)
  const likedYou = await db.query(
    `SELECT u.id, p.display_name, p.city, p.state,
            (SELECT filename FROM photos ph WHERE ph.user_id = u.id AND ph.is_private = false
               ORDER BY ph.is_primary DESC LIMIT 1) AS photo
       FROM likes l
       JOIN users u ON u.id = l.from_user
       JOIN profiles p ON p.user_id = u.id
      WHERE l.to_user = $1 AND l.action = 'like'
        AND NOT EXISTS (SELECT 1 FROM likes me WHERE me.from_user = $1 AND me.to_user = u.id)
        AND u.is_active = true
      ORDER BY l.created_at DESC`,
    [uid]
  );

  res.render('matches', {
    title: 'Matches',
    bodyClass: 'matches-page',
    matches,
    likedYou: likedYou.rows,
    likedYouCount: likedYou.rowCount,
    isGold,
    tab: req.query.tab || 'matches',
  });
});

// ── Like ─────────────────────────────────────────────────────────────
router.post('/like/:id', async (req, res) => {
  const target = req.params.id;
  const uid = req.user.id;
  if (!/^[0-9a-f-]{36}$/i.test(target) || target === uid) return res.redirect('/browse');

  await db.query(
    `INSERT INTO likes (from_user, to_user, action) VALUES ($1,$2,'like')
       ON CONFLICT (from_user, to_user) DO UPDATE SET action = 'like', created_at = now()`,
    [uid, target]
  );

  // Mutual?
  const back = await db.query(
    `SELECT 1 FROM likes WHERE from_user = $1 AND to_user = $2 AND action = 'like'`,
    [target, uid]
  );
  let matched = false;
  if (back.rowCount) {
    await ensureConversation(uid, target);
    matched = true;
  }

  if (wantsJson(req)) return res.json({ ok: true, matched });
  if (matched) req.flash('success', "It's a match! Say hello.");
  return res.redirect(req.get('referer') || '/browse');
});

// ── Pass ─────────────────────────────────────────────────────────────
router.post('/pass/:id', async (req, res) => {
  const target = req.params.id;
  const uid = req.user.id;
  if (/^[0-9a-f-]{36}$/i.test(target) && target !== uid) {
    await db.query(
      `INSERT INTO likes (from_user, to_user, action) VALUES ($1,$2,'pass')
         ON CONFLICT (from_user, to_user) DO UPDATE SET action = 'pass', created_at = now()`,
      [uid, target]
    );
  }
  if (wantsJson(req)) return res.json({ ok: true });
  return res.redirect(req.get('referer') || '/browse');
});

function wantsJson(req) {
  return (req.get('accept') || '').includes('application/json') || req.xhr;
}

module.exports = router;
module.exports.ensureConversation = ensureConversation;
