'use strict';

const db = require('../db/pool');

/**
 * Loads the current user (if any) onto req.user + res.locals.currentUser for
 * every request. Cheap single query; keeps templates simple.
 */
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  req.user = null;
  const uid = req.session && req.session.userId;
  if (!uid) return next();
  try {
    const { rows } = await db.query(
      `SELECT u.*, p.display_name, p.city, p.state
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
        WHERE u.id = $1 AND u.is_active = true`,
      [uid]
    );
    if (rows[0]) {
      req.user = rows[0];
      res.locals.currentUser = rows[0];
      // fire-and-forget last_active bump (no await to keep requests snappy)
      db.query('UPDATE users SET last_active = now() WHERE id = $1', [uid]).catch(() => {});
    } else {
      req.session.destroy(() => {});
    }
  } catch (err) {
    console.error('[auth] loadUser failed', err.message);
  }
  next();
}

/** Gate: must be the age-verified splash passed (18+). */
function requireAge(req, res, next) {
  if (req.session && req.session.ageOk) return next();
  return res.redirect('/enter?next=' + encodeURIComponent(req.originalUrl));
}

/** Gate: must be logged in. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

/** Gate: logged in AND finished onboarding (has a profile). */
function requireOnboarded(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (!req.user.onboarded) return res.redirect('/onboarding');
  return next();
}

/** Gate: Gold members only (used for premium features). */
function requireGold(req, res, next) {
  if (req.user && req.user.membership === 'gold') return next();
  return res.redirect('/membership?upgrade=1&from=' + encodeURIComponent(req.originalUrl));
}

/** Gate: admin only. */
function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  return res.status(404).render('error', { title: 'Not found', message: 'Not found.' });
}

module.exports = {
  loadUser,
  requireAge,
  requireAuth,
  requireOnboarded,
  requireGold,
  requireAdmin,
};
