'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth, requireOnboarded, requireGold } = require('../middleware/auth');
const { slugify } = require('../lib/helpers');

const EVENT_TYPES = {
  party: 'House Party',
  club: 'Lifestyle Club',
  meetup: 'Meet & Greet',
  takeover: 'Resort / Takeover',
  online: 'Online',
};

router.use(requireAuth, requireOnboarded);

// ── List ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const params = [];
  const where = ['starts_at > now() - interval \'12 hours\'', 'is_public = true'];
  if (req.query.state) {
    params.push(req.query.state);
    where.push(`state = $${params.length}`);
  }
  if (req.query.type && EVENT_TYPES[req.query.type]) {
    params.push(req.query.type);
    where.push(`event_type = $${params.length}`);
  }
  const { rows: events } = await db.query(
    `SELECT e.*,
            (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going
       FROM events e
      WHERE ${where.join(' AND ')}
      ORDER BY starts_at ASC
      LIMIT 60`,
    params
  );
  res.render('events/index', {
    title: 'Events & clubs',
    bodyClass: 'events-page',
    events,
    eventTypes: EVENT_TYPES,
    filters: { state: req.query.state || '', type: req.query.type || '' },
  });
});

// ── New (Gold hosts) ─────────────────────────────────────────────────
router.get('/new', requireGold, (req, res) => {
  res.render('events/new', {
    title: 'Host an event',
    bodyClass: 'page-narrow',
    eventTypes: EVENT_TYPES,
    values: {},
    error: null,
  });
});

router.post('/', requireGold, async (req, res) => {
  const b = req.body;
  const fail = (error) =>
    res.status(400).render('events/new', {
      title: 'Host an event',
      bodyClass: 'page-narrow',
      eventTypes: EVENT_TYPES,
      values: b,
      error,
    });

  const title = String(b.title || '').trim();
  if (title.length < 3) return fail('Please give your event a title.');
  if (!b.starts_at) return fail('Please choose a start date and time.');
  const startsAt = new Date(b.starts_at);
  if (isNaN(startsAt.getTime())) return fail('That start date looks invalid.');
  const type = EVENT_TYPES[b.event_type] ? b.event_type : 'party';

  // Unique slug
  let slug = slugify(title) || 'event';
  const dup = await db.query('SELECT 1 FROM events WHERE slug = $1', [slug]);
  if (dup.rowCount) slug = slug + '-' + Math.floor(startsAt.getTime() / 1000).toString(36);

  try {
    const { rows } = await db.query(
      `INSERT INTO events (host_id, title, slug, description, event_type, venue, city, state, starts_at, ends_at, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING slug`,
      [
        req.user.id, title, slug,
        String(b.description || '').slice(0, 5000) || null,
        type,
        String(b.venue || '').slice(0, 160) || null,
        String(b.city || '').slice(0, 80) || null,
        String(b.state || '').slice(0, 4) || null,
        startsAt,
        b.ends_at ? new Date(b.ends_at) : null,
        b.is_public !== 'off',
      ]
    );
    req.flash('success', 'Event published.');
    res.redirect('/events/' + rows[0].slug);
  } catch (err) {
    console.error('[events] create error', err);
    fail('Could not create the event. Please try again.');
  }
});

// ── Show ─────────────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  const { rows } = await db.query(
    `SELECT e.*, p.display_name AS host_name
       FROM events e
       LEFT JOIN profiles p ON p.user_id = e.host_id
      WHERE e.slug = $1`,
    [req.params.slug]
  );
  const event = rows[0];
  if (!event) return next();

  const [{ rows: attendees }, mine] = await Promise.all([
    db.query(
      `SELECT u.id, p.display_name, r.status,
              (SELECT filename FROM photos ph WHERE ph.user_id = u.id AND ph.is_private = false
                 ORDER BY ph.is_primary DESC LIMIT 1) AS photo
         FROM event_rsvps r
         JOIN users u ON u.id = r.user_id
         JOIN profiles p ON p.user_id = u.id
        WHERE r.event_id = $1 AND u.is_active = true
        ORDER BY r.created_at`,
      [event.id]
    ),
    db.query('SELECT status FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [event.id, req.user.id]),
  ]);

  res.render('events/show', {
    title: event.title,
    bodyClass: 'event-detail',
    event,
    eventTypes: EVENT_TYPES,
    attendees,
    myRsvp: mine.rows[0] ? mine.rows[0].status : null,
  });
});

// ── RSVP ─────────────────────────────────────────────────────────────
router.post('/:id/rsvp', async (req, res) => {
  const id = req.params.id;
  const status = req.body.status === 'interested' ? 'interested' : 'going';
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    if (req.body.status === 'none') {
      await db.query('DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
    } else {
      await db.query(
        `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,$3)
           ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status`,
        [id, req.user.id, status]
      );
    }
  }
  res.redirect(req.get('referer') || '/events');
});

module.exports = router;
