# Velvet — Lifestyle / Swinger Community Platform (MVP)

A premium, discreet, web-first platform for the lifestyle community — built to make the
decade-old incumbents (SLS, SDC, AFF) look as dated as they are. Server-rendered for SEO,
privacy-first by design, Railway-ready.

> **Brandable.** "Velvet" is a placeholder name driven by `BRAND_NAME`. Rename the whole
> product in one env var.

## What's built

| Area | Status |
|------|--------|
| Age gate (18+) | ✅ |
| Signup / login / sessions (bcrypt, Postgres-backed) | ✅ |
| Account types (couple / single M/F/NB / group) | ✅ |
| Multi-section profile onboarding + edit | ✅ |
| Photo upload + **public/private galleries with per-member access grants** | ✅ |
| Browse / search (location, type, keyword, online, interests*) | ✅ |
| Like → mutual match → auto conversation | ✅ |
| "Who liked you" (Gold reveal) | ✅ |
| Messaging (threads, unread counts, free-tier daily limit) | ✅ |
| Events & clubs (list, host*, detail, RSVP) | ✅ |
| Freemium tiers (Free / Gold) + **CCBill high-risk processor handoff + webhook** | ✅ |
| Blocking, reporting, safety pages | ✅ |
| Legal templates (Terms / Privacy / Guidelines) | ✅ |
| Demo seed data (12 profiles + events) | ✅ |

\* Gold-gated features.

## Tech

- **Node / Express** + **EJS** (server-rendered → SEO advantage)
- **PostgreSQL** (`pg`) — schema auto-migrates on boot (`db/schema.sql`, idempotent)
- **bcryptjs**, **express-session** + `connect-pg-simple`, **helmet**, **multer**, **express-rate-limit**

## Run locally

```bash
cp .env.example .env          # set SESSION_SECRET + DATABASE_URL
createdb velvet               # or point DATABASE_URL at any Postgres
npm install
npm run migrate               # optional — server also migrates on boot
SEED_DEMO=true npm start      # seeds demo profiles/events the first time
# → http://localhost:3000
```

Demo logins after seeding: `demo1@velvet.local` … `demo12@velvet.local` / `demopassword`.

## Deploy (Railway)

1. Create a Railway project from this repo (already at `PalmettoAI/Swinger-Site`).
2. Add the **PostgreSQL** plugin — `DATABASE_URL` is injected automatically.
3. Set variables: `SESSION_SECRET`, `NODE_ENV=production`, `BRAND_NAME`, and the
   `CCBILL_*` keys when the merchant account is live.
4. **Attach a Volume mounted at `/app/uploads`** (set `UPLOAD_DIR=/app/uploads`) so photos
   persist across deploys — Railway's filesystem is otherwise ephemeral. (Or switch
   `routes/photos.js` to Cloudflare R2 / S3 for scale.)
5. Deploy. Schema migrates on first boot; healthcheck is `/healthz`.

## The important real-world caveats (from the market research)

- **Payments:** Stripe / PayPal / Square **prohibit** adult content. This ships with a
  **CCBill FlexForms** handoff (`routes/membership.js`) + webhook — swap in Epoch/SegPay
  by editing that one file. `DEV_INSTANT_UPGRADE=true` lets you test the Gold flow locally
  without a live merchant account.
- **No app stores / no Google-Meta ads:** growth is SEO + community + affiliate + Reddit.
  The site is server-rendered and clean for exactly this reason. (`noindex` is on by
  default — flip it in `views/layout*.ejs` when you're ready to be crawled.)
- **Cold start:** seed data + a single-metro soft launch strategy. Consider "free Gold for
  founding couples in city X" — the tier system already supports comping members.

## Next steps toward production

- Object storage (R2/S3) + image resizing/moderation for photos
- Email verification + password reset (transactional email)
- Real age/ID verification vendor for compliance
- Realtime messaging (WebSocket) + push/email notifications
- Affiliate/referral program (SLS pays 50% lifetime — LTV supports it)
- Admin moderation dashboard (reports table + blocks already wired)
- Rate-limit + abuse controls on messaging; bot/fake-profile detection

## Layout

```
config/        env-driven config (brand, tiers, payments, uploads)
db/            pool, schema.sql, migrate, seed
lib/           geo, helpers, shared profile-save
middleware/    auth / age / onboarding / gold / admin gates
routes/        pages, auth, onboarding, browse, profile, matches, messages, events, membership, photos
views/         EJS templates (+ layout, partials)
public/        css design system, js, favicon
```
