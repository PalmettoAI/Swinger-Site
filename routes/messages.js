'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { ensureConversation } = require('./matches');

router.use(requireAuth, requireOnboarded);

// ── Inbox ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const uid = req.user.id;
  const { rows: convos } = await db.query(
    `SELECT c.id, c.last_at,
            other.id AS other_id, p.display_name, p.city, p.state,
            (SELECT filename FROM photos ph WHERE ph.user_id = other.id AND ph.is_private = false
               ORDER BY ph.is_primary DESC LIMIT 1) AS photo,
            (SELECT body FROM messages m WHERE m.convo_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT count(*) FROM messages m WHERE m.convo_id = c.id AND m.from_user <> $1 AND m.read_at IS NULL) AS unread
       FROM conversations c
       JOIN users other ON other.id = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
       JOIN profiles p ON p.user_id = other.id
      WHERE (c.user_a = $1 OR c.user_b = $1) AND other.is_active = true
      ORDER BY c.last_at DESC`,
    [uid]
  );

  res.render('messages/inbox', {
    title: 'Messages',
    bodyClass: 'messages-page',
    convos,
  });
});

// ── Start a conversation with a user ─────────────────────────────────
router.get('/new/:userId', async (req, res) => {
  const target = req.params.userId;
  if (!/^[0-9a-f-]{36}$/i.test(target) || target === req.user.id) return res.redirect('/messages');
  const convoId = await ensureConversation(req.user.id, target);
  res.redirect('/messages/' + convoId);
});

// ── Thread ───────────────────────────────────────────────────────────
router.get('/:convoId', async (req, res, next) => {
  const convoId = req.params.convoId;
  if (!/^[0-9a-f-]{36}$/i.test(convoId)) return next();
  const uid = req.user.id;

  const convo = await loadConvo(convoId, uid);
  if (!convo) return next();

  const { rows: messages } = await db.query(
    'SELECT * FROM messages WHERE convo_id = $1 ORDER BY created_at ASC',
    [convoId]
  );
  // Mark incoming as read
  await db.query(
    'UPDATE messages SET read_at = now() WHERE convo_id = $1 AND from_user <> $2 AND read_at IS NULL',
    [convoId, uid]
  );

  res.render('messages/thread', {
    title: convo.display_name,
    bodyClass: 'messages-page thread',
    convo,
    messages,
    remaining: await remainingMessages(req.user),
  });
});

// ── Send ─────────────────────────────────────────────────────────────
router.post('/:convoId', async (req, res, next) => {
  const convoId = req.params.convoId;
  if (!/^[0-9a-f-]{36}$/i.test(convoId)) return next();
  const uid = req.user.id;
  const body = String(req.body.body || '').trim().slice(0, 4000);

  const convo = await loadConvo(convoId, uid);
  if (!convo) return next();
  if (!body) return res.redirect('/messages/' + convoId);

  // Free-tier daily limit
  if (req.user.membership !== 'gold') {
    const used = await incrementCounter(uid);
    if (used > config.membership.freeDailyMessageLimit) {
      req.flash('error', "You've hit today's free message limit. Upgrade to Gold for unlimited messaging.");
      return res.redirect('/membership?upgrade=1');
    }
  }

  await db.query(
    'INSERT INTO messages (convo_id, from_user, body) VALUES ($1,$2,$3)',
    [convoId, uid, body]
  );
  await db.query('UPDATE conversations SET last_at = now() WHERE id = $1', [convoId]);
  res.redirect('/messages/' + convoId);
});

// ── helpers ──────────────────────────────────────────────────────────
async function loadConvo(convoId, uid) {
  const { rows } = await db.query(
    `SELECT c.*,
            other.id AS other_id, other.account_type, other.membership,
            p.display_name, p.city, p.state,
            (SELECT filename FROM photos ph WHERE ph.user_id = other.id AND ph.is_private = false
               ORDER BY ph.is_primary DESC LIMIT 1) AS photo
       FROM conversations c
       JOIN users other ON other.id = CASE WHEN c.user_a = $2 THEN c.user_b ELSE c.user_a END
       JOIN profiles p ON p.user_id = other.id
      WHERE c.id = $1 AND (c.user_a = $2 OR c.user_b = $2)`,
    [convoId, uid]
  );
  return rows[0] || null;
}

async function incrementCounter(uid) {
  const { rows } = await db.query(
    `INSERT INTO message_counters (user_id, day, count) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET count = message_counters.count + 1
       RETURNING count`,
    [uid]
  );
  return rows[0].count;
}

async function remainingMessages(user) {
  if (user.membership === 'gold') return null;
  const { rows } = await db.query(
    'SELECT count FROM message_counters WHERE user_id = $1 AND day = CURRENT_DATE',
    [user.id]
  );
  const used = rows[0] ? rows[0].count : 0;
  return Math.max(0, config.membership.freeDailyMessageLimit - used);
}

module.exports = router;
