'use strict';

/**
 * Central configuration. Everything brandable / environment-driven lives here so
 * the platform can be white-labeled or re-pointed without hunting through code.
 */

const BRAND = process.env.BRAND_NAME || 'Velvet';

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  brand: {
    name: BRAND,
    tagline: process.env.BRAND_TAGLINE || 'The lifestyle, elevated.',
    supportEmail: process.env.SUPPORT_EMAIL || 'support@velvet.example',
    // Used in <title>, schema, emails
    legalName: process.env.LEGAL_NAME || `${BRAND} Social LLC`,
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    // 30 days
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },

  db: {
    // Railway provides DATABASE_URL automatically when a Postgres plugin is attached
    url: process.env.DATABASE_URL || null,
    ssl: String(process.env.PGSSL || (process.env.DATABASE_URL ? 'true' : 'false')) === 'true',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || require('path').join(__dirname, '..', 'uploads'),
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES || String(8 * 1024 * 1024), 10), // 8MB
    // NOTE (production): Railway's filesystem is ephemeral. Attach a Volume mounted
    // at UPLOAD_DIR, or swap the photos route for Cloudflare R2 / S3 (see routes/photos.js).
  },

  // Membership tiers. Prices are display-only here; real charges route through the
  // high-risk processor (see below). Adult/lifestyle content is prohibited by
  // Stripe/PayPal/Square — CCBill/Epoch/SegPay are the industry-standard options.
  membership: {
    tiers: {
      free: {
        key: 'free',
        label: 'Free',
        priceMonthly: 0,
        blurb: 'Create a profile, browse, and start connecting.',
        features: [
          'Create couple or single profile',
          'Browse members near you',
          'Send up to 5 messages / day',
          'Attend public events',
        ],
      },
      gold: {
        key: 'gold',
        label: 'Gold',
        priceMonthly: 20,
        priceAnnual: 180,
        blurb: 'The full experience — unlimited connection.',
        features: [
          'Unlimited messaging',
          'See who liked you',
          'Video profiles & unlimited photos',
          'Private photo galleries with access control',
          'Advanced search filters (kinks, distance, age)',
          'Host & promote events',
          'Priority placement in browse',
        ],
      },
    },
    freeDailyMessageLimit: parseInt(process.env.FREE_MSG_LIMIT || '5', 10),
    freePhotoLimit: parseInt(process.env.FREE_PHOTO_LIMIT || '3', 10),
    goldPhotoLimit: parseInt(process.env.GOLD_PHOTO_LIMIT || '30', 10),
  },

  // Payment processor integration point. See routes/membership.js.
  payments: {
    provider: process.env.PAYMENT_PROVIDER || 'ccbill', // ccbill | epoch | segpay
    // CCBill FlexForms — fill these from the CCBill merchant dashboard at launch.
    ccbill: {
      clientAccnum: process.env.CCBILL_ACCNUM || '',
      clientSubacc: process.env.CCBILL_SUBACC || '',
      flexFormId: process.env.CCBILL_FLEXFORM_ID || '',
      salt: process.env.CCBILL_SALT || '', // for webhook signature verification
    },
    // In development we allow a fake "upgrade" so the flow is testable end-to-end.
    devInstantUpgrade: String(process.env.DEV_INSTANT_UPGRADE || 'true') === 'true',
  },

  seed: {
    enabled: String(process.env.SEED_DEMO || 'false') === 'true',
  },
};
