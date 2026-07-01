'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const config = require('../config');
const geo = require('../lib/geo');
const { saveProfile } = require('../lib/saveProfile');
const { requireAuth, requireOnboarded } = require('../middleware/auth');
const { INTEREST_TAGS, LOOKING_FOR, ACCOUNT_TYPES } = require('../lib/helpers');

router.use(requireAuth);

// ── My profile ───────────────────────────────────────────────────────
router.get('/', requireOnboarded, async (req, res) => {
  const [{ rows: prof }, { rows: photos }] = await Promise.all([
    db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]),
    db.query('SELECT * FROM photos WHERE user_id = $1 ORDER BY is_primary DESC, sort_order, created_at', [req.user.id]),
  ]);
  res.render('profile/show', {
    title: prof[0] ? prof[0].display_name : 'My profile',
    bodyClass: 'profile-page',
    profile: prof[0],
    user: req.user,
    photos,
    isOwn: true,
    canSeePrivate: true,
    liked: false,
    mutual: false,
    accessStatus: null,
    distance: null,
  });
});

// ── Edit profile (reuses onboarding form) ───────────────────────────
router.get('/edit', requireOnboarded, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
  res.render('onboarding/index', {
    title: 'Edit profile',
    bodyClass: 'onboarding',
    profile: rows[0] || {},
    accountType: req.user.account_type,
    accountTypes: ACCOUNT_TYPES,
    metros: geo.metroList(),
    interestTags: INTEREST_TAGS,
    lookingForOptions: LOOKING_FOR,
    formAction: '/profile/edit',
    isEdit: true,
    error: null,
  });
});

router.post('/edit', requireOnboarded, async (req, res) => {
  try {
    const result = await saveProfile(req.user, req.body);
    if (!result.ok) {
      return res.status(400).render('onboarding/index', {
        title: 'Edit profile',
        bodyClass: 'onboarding',
        profile: req.body,
        accountType: req.user.account_type,
        accountTypes: ACCOUNT_TYPES,
        metros: geo.metroList(),
        interestTags: INTEREST_TAGS,
        lookingForOptions: LOOKING_FOR,
        formAction: '/profile/edit',
        isEdit: true,
        error: result.error,
      });
    }
    req.flash('success', 'Profile updated.');
    return res.redirect('/profile');
  } catch (err) {
    console.error('[profile] edit error', err);
    return res.redirect('/profile/edit');
  }
});

// ── Photo manager ────────────────────────────────────────────────────
router.get('/photos', requireOnboarded, async (req, res) => {
  const { rows: photos } = await db.query(
    'SELECT * FROM photos WHERE user_id = $1 ORDER BY is_primary DESC, sort_order, created_at',
    [req.user.id]
  );
  const limit = req.user.membership === 'gold'
    ? config.membership.goldPhotoLimit
    : config.membership.freePhotoLimit;

  // Pending access requests to my private gallery
  const { rows: requests } = await db.query(
    `SELECT pa.viewer_id, p.display_name, pa.created_at
       FROM photo_access pa
       JOIN profiles p ON p.user_id = pa.viewer_id
      WHERE pa.owner_id = $1 AND pa.status = 'requested'
      ORDER BY pa.created_at DESC`,
    [req.user.id]
  );

  res.render('profile/photos', {
    title: 'Your photos',
    bodyClass: 'profile-page',
    photos,
    limit,
    requests,
  });
});

// ── Account settings ────────────────────────────────────────────────
router.get('/settings', requireAuth, async (req, res) => {
  res.render('profile/settings', {
    title: 'Account settings',
    bodyClass: 'page-narrow',
    accountTypes: ACCOUNT_TYPES,
    error: null,
    success: null,
  });
});

router.post('/settings/password', requireAuth, async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const render = (opts) =>
    res.render('profile/settings', {
      title: 'Account settings',
      bodyClass: 'page-narrow',
      accountTypes: ACCOUNT_TYPES,
      error: null,
      success: null,
      ...opts,
    });
  try {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current, rows[0].password_hash);
    if (!ok) return render({ error: 'Current password is incorrect.' });
    if (next.length < 8) return render({ error: 'New password must be at least 8 characters.' });
    const hash = await bcrypt.hash(next, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    return render({ success: 'Password updated.' });
  } catch (err) {
    console.error('[profile] password error', err);
    return render({ error: 'Could not update password.' });
  }
});

router.post('/settings/deactivate', requireAuth, async (req, res) => {
  await db.query('UPDATE users SET is_active = false WHERE id = $1', [req.user.id]);
  req.session.destroy(() => res.redirect('/'));
});

// ── View another member ─────────────────────────────────────────────
// Keep this LAST so /edit, /photos, /settings aren't captured as :id.
router.get('/:id', requireOnboarded, async (req, res, next) => {
  const id = req.params.id;
  // basic uuid guard
  if (!/^[0-9a-f-]{36}$/i.test(id)) return next();
  if (id === req.user.id) return res.redirect('/profile');

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.account_type, u.membership, u.last_active, u.created_at,
              p.*
         FROM users u JOIN profiles p ON p.user_id = u.id
        WHERE u.id = $1 AND u.is_active = true`,
      [id]
    );
    const profile = rows[0];
    if (!profile) return next();

    // Blocked either direction? hide.
    const blocked = await db.query(
      `SELECT 1 FROM blocks
        WHERE (blocker_id = $1 AND blocked_id = $2)
           OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
      [req.user.id, id]
    );
    if (blocked.rowCount) return next();

    const [{ rows: photos }, likeRes, likedBackRes, accessRes] = await Promise.all([
      db.query('SELECT * FROM photos WHERE user_id = $1 ORDER BY is_primary DESC, sort_order, created_at', [id]),
      db.query(`SELECT action FROM likes WHERE from_user = $1 AND to_user = $2`, [req.user.id, id]),
      db.query(`SELECT action FROM likes WHERE from_user = $1 AND to_user = $2`, [id, req.user.id]),
      db.query(`SELECT status FROM photo_access WHERE owner_id = $1 AND viewer_id = $2`, [id, req.user.id]),
    ]);

    const liked = likeRes.rows[0] && likeRes.rows[0].action === 'like';
    const likedBack = likedBackRes.rows[0] && likedBackRes.rows[0].action === 'like';
    const mutual = liked && likedBack;
    const accessStatus = accessRes.rows[0] ? accessRes.rows[0].status : null;
    const canSeePrivate = accessStatus === 'granted';

    const me = await db.query('SELECT lat, lng FROM profiles WHERE user_id = $1', [req.user.id]);
    const distance = me.rows[0]
      ? geo.milesBetween(me.rows[0].lat, me.rows[0].lng, profile.lat, profile.lng)
      : null;

    res.render('profile/show', {
      title: profile.display_name,
      bodyClass: 'profile-page',
      profile,
      user: { id: profile.id, account_type: profile.account_type, membership: profile.membership, last_active: profile.last_active },
      photos,
      isOwn: false,
      canSeePrivate,
      liked,
      mutual,
      accessStatus,
      distance,
    });
  } catch (err) {
    console.error('[profile] view error', err);
    next(err);
  }
});

// ── Block / report ───────────────────────────────────────────────────
router.post('/:id/block', requireOnboarded, async (req, res) => {
  const id = req.params.id;
  if (/^[0-9a-f-]{36}$/i.test(id) && id !== req.user.id) {
    await db.query(
      `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, id]
    );
    req.flash('success', 'Member blocked. You will no longer see each other.');
  }
  res.redirect('/browse');
});

router.post('/:id/report', requireOnboarded, async (req, res) => {
  const id = req.params.id;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    await db.query(
      `INSERT INTO reports (reporter_id, target_id, reason, detail)
       VALUES ($1,$2,$3,$4)`,
      [req.user.id, id, String(req.body.reason || 'unspecified').slice(0, 100), String(req.body.detail || '').slice(0, 2000)]
    );
    req.flash('success', 'Report received. Our team will review it.');
  }
  res.redirect('/profile/' + id);
});

module.exports = router;
