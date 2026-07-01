-- Velvet lifestyle platform — schema
-- Idempotent: safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Session store (connect-pg-simple) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ── Users / accounts ────────────────────────────────────────────────
-- account_type reflects lifestyle conventions: couples, single M/F, etc.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  email_norm    text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  account_type  text NOT NULL DEFAULT 'couple'
                CHECK (account_type IN ('couple','single_male','single_female','single_nonbinary','group')),
  membership    text NOT NULL DEFAULT 'free' CHECK (membership IN ('free','gold')),
  membership_since   timestamptz,
  membership_expires timestamptz,
  age_verified  boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  is_admin      boolean NOT NULL DEFAULT false,
  onboarded     boolean NOT NULL DEFAULT false,
  last_active   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Profiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  headline      text,
  about         text,
  -- Partner 1 / self
  p1_age        int  CHECK (p1_age IS NULL OR p1_age BETWEEN 18 AND 120),
  p1_gender     text,
  p1_orientation text,
  -- Partner 2 (couples only)
  p2_age        int  CHECK (p2_age IS NULL OR p2_age BETWEEN 18 AND 120),
  p2_gender     text,
  p2_orientation text,
  -- Location
  city          text,
  state         text,
  country       text DEFAULT 'US',
  lat           double precision,
  lng           double precision,
  -- Preferences
  looking_for   text[] DEFAULT '{}',   -- e.g. {couples, single_female, friends}
  interests     text[] DEFAULT '{}',   -- kinks / activities (tags)
  smoking       text,
  drinking      text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles (state, city);
CREATE INDEX IF NOT EXISTS idx_profiles_interests ON profiles USING gin (interests);

-- ── Photos (with privacy controls — the core trust feature) ─────────
CREATE TABLE IF NOT EXISTS photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  is_private  boolean NOT NULL DEFAULT false, -- private = locked until access granted
  caption     text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_user ON photos (user_id);

-- ── Private photo access grants ─────────────────────────────────────
-- owner grants viewer access to their private gallery
CREATE TABLE IF NOT EXISTS photo_access (
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'granted' CHECK (status IN ('requested','granted','denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, viewer_id)
);

-- ── Likes → mutual matches ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS likes (
  from_user  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     text NOT NULL DEFAULT 'like' CHECK (action IN ('like','pass')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_user, to_user)
);
CREATE INDEX IF NOT EXISTS idx_likes_to ON likes (to_user) WHERE action = 'like';

-- ── Conversations & messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_at     timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  convo_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_user   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        text NOT NULL,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages (convo_id, created_at);

-- ── Events / club listings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  event_type  text NOT NULL DEFAULT 'party'
              CHECK (event_type IN ('party','club','meetup','takeover','online')),
  venue       text,
  city        text,
  state       text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  cover_photo text,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_when ON events (starts_at);
CREATE INDEX IF NOT EXISTS idx_events_where ON events (state, city);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'going' CHECK (status IN ('going','interested')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- ── Blocks & reports (safety) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  reason      text NOT NULL,
  detail      text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Daily message counters (free-tier throttle) ─────────────────────
CREATE TABLE IF NOT EXISTS message_counters (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date NOT NULL DEFAULT CURRENT_DATE,
  count   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
