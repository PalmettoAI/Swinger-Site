'use strict';

const db = require('../db/pool');
const geo = require('./geo');

/**
 * Validates + upserts a profile from a submitted form body.
 * Returns { ok: true } or { ok: false, error }.
 * Shared by onboarding and profile edit so the rules never drift apart.
 */
async function saveProfile(user, body) {
  const isCouple = user.account_type === 'couple' || user.account_type === 'group';
  const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const asInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  const displayName = String(body.display_name || '').trim();
  const loc = geo.resolveCity(body.location);

  if (displayName.length < 2) return { ok: false, error: 'Please choose a display name.' };
  if (!loc) return { ok: false, error: 'Please select your city.' };

  const p1Age = asInt(body.p1_age);
  if (p1Age !== null && p1Age < 18) return { ok: false, error: 'All members must be 18 or older.' };
  const p2Age = asInt(body.p2_age);
  if (isCouple && p2Age !== null && p2Age < 18)
    return { ok: false, error: 'All members must be 18 or older.' };

  await db.query(
    `INSERT INTO profiles
      (user_id, display_name, headline, about,
       p1_age, p1_gender, p1_orientation,
       p2_age, p2_gender, p2_orientation,
       city, state, country, lat, lng,
       looking_for, interests, smoking, drinking, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       headline = EXCLUDED.headline,
       about = EXCLUDED.about,
       p1_age = EXCLUDED.p1_age, p1_gender = EXCLUDED.p1_gender, p1_orientation = EXCLUDED.p1_orientation,
       p2_age = EXCLUDED.p2_age, p2_gender = EXCLUDED.p2_gender, p2_orientation = EXCLUDED.p2_orientation,
       city = EXCLUDED.city, state = EXCLUDED.state, country = EXCLUDED.country,
       lat = EXCLUDED.lat, lng = EXCLUDED.lng,
       looking_for = EXCLUDED.looking_for, interests = EXCLUDED.interests,
       smoking = EXCLUDED.smoking, drinking = EXCLUDED.drinking,
       updated_at = now()`,
    [
      user.id,
      displayName,
      String(body.headline || '').trim().slice(0, 140) || null,
      String(body.about || '').trim().slice(0, 4000) || null,
      p1Age, body.p1_gender || null, body.p1_orientation || null,
      isCouple ? p2Age : null, isCouple ? body.p2_gender || null : null, isCouple ? body.p2_orientation || null : null,
      loc.city, loc.state, 'US', loc.lat, loc.lng,
      asArray(body.looking_for), asArray(body.interests),
      body.smoking || null, body.drinking || null,
    ]
  );

  return { ok: true };
}

module.exports = { saveProfile };
