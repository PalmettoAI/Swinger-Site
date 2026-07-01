'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const geo = require('../lib/geo');
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { INTEREST_TAGS, ACCOUNT_TYPES } = require('../lib/helpers');

router.use(requireAuth, requireOnboarded);

const PAGE_SIZE = 24;

router.get('/', async (req, res) => {
  const q = req.query;
  const isGold = req.user.membership === 'gold';
  const page = Math.max(1, parseInt(q.page, 10) || 1);

  // Build a parameterized filter.
  const where = [
    'u.id <> $1',
    'u.is_active = true',
    'u.onboarded = true',
    // exclude blocks in either direction
    `NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id = $1 AND b.blocked_id = u.id) OR
        (b.blocker_id = u.id AND b.blocked_id = $1))`,
  ];
  const params = [req.user.id];

  if (q.account_type && ACCOUNT_TYPES[q.account_type]) {
    params.push(q.account_type);
    where.push(`u.account_type = $${params.length}`);
  }
  if (q.state) {
    params.push(q.state);
    where.push(`p.state = $${params.length}`);
  }
  if (q.q) {
    params.push('%' + String(q.q).trim() + '%');
    where.push(`(p.display_name ILIKE $${params.length} OR p.headline ILIKE $${params.length} OR p.about ILIKE $${params.length})`);
  }
  // Advanced (Gold): interest tag filter
  let interestFilter = [];
  if (isGold && q.interests) {
    interestFilter = Array.isArray(q.interests) ? q.interests : [q.interests];
    if (interestFilter.length) {
      params.push(interestFilter);
      where.push(`p.interests && $${params.length}::text[]`);
    }
  }
  if (q.online === '1') {
    where.push(`u.last_active > now() - interval '15 minutes'`);
  }
  if (q.has_photo === '1') {
    where.push(`EXISTS (SELECT 1 FROM photos ph WHERE ph.user_id = u.id)`);
  }

  const whereSql = where.join(' AND ');

  // Gold members surface first, then most recently active.
  const offset = (page - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE + 1, offset);

  const sql = `
    SELECT u.id, u.account_type, u.membership, u.last_active,
           p.display_name, p.headline, p.city, p.state, p.lat, p.lng,
           p.interests, p.p1_age, p2_age,
           (SELECT filename FROM photos ph WHERE ph.user_id = u.id AND ph.is_private = false
              ORDER BY ph.is_primary DESC, ph.sort_order LIMIT 1) AS photo,
           (SELECT count(*) FROM photos ph WHERE ph.user_id = u.id) AS photo_count
      FROM users u
      JOIN profiles p ON p.user_id = u.id
     WHERE ${whereSql}
     ORDER BY (u.membership = 'gold') DESC, u.last_active DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await db.query(sql, params);
  const hasNext = rows.length > PAGE_SIZE;
  const members = rows.slice(0, PAGE_SIZE);

  // Attach distance if we know both coordinates.
  const meLoc = await db.query('SELECT lat, lng FROM profiles WHERE user_id = $1', [req.user.id]);
  const me = meLoc.rows[0] || {};
  for (const m of members) {
    m.distance = geo.milesBetween(me.lat, me.lng, m.lat, m.lng);
  }

  res.render('browse', {
    title: 'Browse members',
    bodyClass: 'browse-page',
    members,
    accountTypes: ACCOUNT_TYPES,
    interestTags: INTEREST_TAGS,
    states: US_STATES,
    filters: {
      account_type: q.account_type || '',
      state: q.state || '',
      q: q.q || '',
      online: q.online === '1',
      has_photo: q.has_photo === '1',
      interests: interestFilter,
    },
    isGold,
    page,
    hasNext,
  });
});

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

module.exports = router;
