'use strict';

const bcrypt = require('bcryptjs');
const db = require('./pool');
const geo = require('../lib/geo');
const { slugify } = require('../lib/helpers');

/**
 * Seeds demo profiles + events so the platform doesn't look empty during
 * development/demos (helps show Tony the "critical mass" feel). Idempotent:
 * guarded by a sentinel account. Enable with SEED_DEMO=true.
 * NEVER enable in production with real members.
 */

const DEMO = [
  { name: 'J&M', type: 'couple', city: 'Charlotte, NC', headline: 'Playful couple, always up for a good time', p1: [34, 'Male', 'Straight'], p2: [31, 'Female', 'Bisexual'], look: ['couples', 'single_female'], tags: ['Soft Swap', 'Same Room', 'House Parties'] },
  { name: 'VelvetPair', type: 'couple', city: 'Atlanta, GA', headline: 'Discreet, classy, selective', p1: [41, 'Male', 'Straight'], p2: [38, 'Female', 'Bi-curious'], look: ['couples'], tags: ['Full Swap', 'Lifestyle Clubs'] },
  { name: 'Scarlet', type: 'single_female', city: 'Miami, FL', headline: 'Solo and confident ✦', p1: [29, 'Female', 'Bisexual'], look: ['couples', 'single_female'], tags: ['Girl-on-Girl', 'Threesomes (MFM)'] },
  { name: 'NightOwl', type: 'single_male', city: 'Las Vegas, NV', headline: 'Respectful, fit, drama-free', p1: [36, 'Male', 'Straight'], look: ['couples'], tags: ['Threesomes (FMF)', 'Friends First'] },
  { name: 'C&K', type: 'couple', city: 'Nashville, TN', headline: 'New to the lifestyle, learning together', p1: [28, 'Male', 'Straight'], p2: [27, 'Female', 'Heteroflexible'], look: ['couples', 'friends'], tags: ['New to the Lifestyle', 'Soft Swap'] },
  { name: 'Aria', type: 'single_female', city: 'Columbia, SC', headline: 'Hotwife energy 🔥', p1: [33, 'Female', 'Straight'], look: ['single_male', 'couples'], tags: ['Hotwife', 'Exhibitionist'] },
  { name: 'TheMalones', type: 'couple', city: 'Columbia, SC', headline: 'Weekend adventurers', p1: [45, 'Male', 'Straight'], p2: [43, 'Female', 'Bisexual'], look: ['couples', 'groups'], tags: ['Group Play', 'Cruises & Travel'] },
  { name: 'D&R', type: 'couple', city: 'Raleigh, NC', headline: 'Foodies who love to play', p1: [39, 'Male', 'Bi-curious'], p2: [37, 'Female', 'Bisexual'], look: ['couples'], tags: ['Full Swap', 'Kink Friendly'] },
  { name: 'Jax', type: 'single_male', city: 'Charlotte, NC', headline: 'Well-traveled, easy company', p1: [42, 'Male', 'Straight'], look: ['couples', 'single_female'], tags: ['Friends First', 'Playful Couples'] },
  { name: 'LuxeCouple', type: 'couple', city: 'Dallas, TX', headline: 'Champagne taste, open minds', p1: [50, 'Male', 'Straight'], p2: [46, 'Female', 'Bi-curious'], look: ['couples', 'single_female'], tags: ['Lifestyle Clubs', 'Voyeur'] },
  { name: 'Sage', type: 'single_nonbinary', city: 'Austin, TX', headline: 'Poly & pansexual, here for connection', p1: [30, 'Non-binary', 'Pansexual'], look: ['couples', 'groups', 'friends'], tags: ['Polyamory', 'Kink Friendly'] },
  { name: 'B&B', type: 'couple', city: 'Tampa, FL', headline: 'Beach house parties all summer', p1: [35, 'Male', 'Straight'], p2: [34, 'Female', 'Bisexual'], look: ['couples', 'single_female'], tags: ['House Parties', 'Same Room', 'Exhibitionist'] },
];

const EVENTS = [
  { title: 'Midnight Masquerade', type: 'party', city: 'Charlotte', state: 'NC', inDays: 9, desc: 'Masks required, dress to impress. Couples & select singles. Full bar, playrooms available.' },
  { title: 'Newbies Meet & Greet', type: 'meetup', city: 'Columbia', state: 'SC', inDays: 4, desc: 'A relaxed, no-pressure evening for those new to the lifestyle. Just drinks and good conversation.' },
  { title: 'Velvet Room Takeover', type: 'club', city: 'Atlanta', state: 'GA', inDays: 16, desc: 'We take over the whole club for the night. Members only. Theme: Old Hollywood glamour.' },
  { title: 'Caribbean Lifestyle Cruise', type: 'takeover', city: 'Miami', state: 'FL', inDays: 60, desc: '5 nights, clothing-optional decks, themed parties every night. Cabins going fast.' },
];

async function seed() {
  const sentinel = await db.query("SELECT 1 FROM users WHERE email_norm = 'demo1@velvet.local'");
  if (sentinel.rowCount) {
    console.log('[seed] demo data already present, skipping');
    return;
  }
  console.log('[seed] inserting demo data…');
  const hash = await bcrypt.hash('demopassword', 10);
  const ids = [];

  for (let i = 0; i < DEMO.length; i++) {
    const d = DEMO[i];
    const loc = geo.resolveCity(d.city);
    const membership = i % 3 === 0 ? 'gold' : 'free';
    const { rows } = await db.query(
      `INSERT INTO users (email, email_norm, password_hash, account_type, membership, age_verified, onboarded, last_active)
       VALUES ($1,$2,$3,$4,$5,true,true, now() - ($6 || ' minutes')::interval)
       RETURNING id`,
      [`demo${i + 1}@velvet.local`, `demo${i + 1}@velvet.local`, hash, d.type, membership, String(i * 37)]
    );
    const uid = rows[0].id;
    ids.push(uid);
    await db.query(
      `INSERT INTO profiles
        (user_id, display_name, headline, about, p1_age, p1_gender, p1_orientation,
         p2_age, p2_gender, p2_orientation, city, state, country, lat, lng, looking_for, interests)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'US',$13,$14,$15,$16)`,
      [
        uid, d.name, d.headline,
        `${d.headline}. We're on ${process.env.BRAND_NAME || 'Velvet'} to meet like-minded, respectful people. Discretion guaranteed.`,
        d.p1[0], d.p1[1], d.p1[2],
        d.p2 ? d.p2[0] : null, d.p2 ? d.p2[1] : null, d.p2 ? d.p2[2] : null,
        loc.city, loc.state, loc.lat, loc.lng, d.look, d.tags,
      ]
    );
  }

  // A few likes to create at least one mutual match among demo users.
  await db.query(`INSERT INTO likes (from_user, to_user, action) VALUES ($1,$2,'like') ON CONFLICT DO NOTHING`, [ids[0], ids[2]]);
  await db.query(`INSERT INTO likes (from_user, to_user, action) VALUES ($1,$2,'like') ON CONFLICT DO NOTHING`, [ids[2], ids[0]]);

  for (const e of EVENTS) {
    let slug = slugify(e.title);
    await db.query(
      `INSERT INTO events (host_id, title, slug, description, event_type, city, state, starts_at, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval, true)
       ON CONFLICT (slug) DO NOTHING`,
      [ids[0], e.title, slug, e.desc, e.type, e.city, e.state, String(e.inDays)]
    );
  }

  console.log(`[seed] done — ${ids.length} demo members + ${EVENTS.length} events`);
}

module.exports = { seed };

if (require.main === module) {
  const { migrate } = require('./migrate');
  migrate()
    .then(seed)
    .then(() => process.exit(0))
    .catch((err) => { console.error('[seed] failed', err); process.exit(1); });
}
