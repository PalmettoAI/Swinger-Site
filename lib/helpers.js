'use strict';

const config = require('../config');

/** Human-friendly account type labels. */
const ACCOUNT_TYPES = {
  couple: 'Couple',
  single_male: 'Single Male',
  single_female: 'Single Female',
  single_nonbinary: 'Single (Non-binary)',
  group: 'Group',
};

/** Curated interest / activity tags shown during onboarding & search. */
const INTEREST_TAGS = [
  'Full Swap', 'Soft Swap', 'Same Room', 'Separate Rooms', 'Voyeur',
  'Exhibitionist', 'Group Play', 'Threesomes (MFM)', 'Threesomes (FMF)',
  'Girl-on-Girl', 'Playful Couples', 'New to the Lifestyle', 'House Parties',
  'Lifestyle Clubs', 'Cruises & Travel', 'Kink Friendly', 'Hotwife',
  'Cuckold', 'Polyamory', 'Friends First',
];

const LOOKING_FOR = [
  { key: 'couples', label: 'Couples' },
  { key: 'single_female', label: 'Single Females' },
  { key: 'single_male', label: 'Single Males' },
  { key: 'groups', label: 'Groups' },
  { key: 'friends', label: 'Friends / Social' },
];

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatEventDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Age from birth year (couples list explicit ages, so mostly for validation). */
function isAdultAge(age) {
  return Number.isInteger(age) && age >= 18;
}

module.exports = {
  ACCOUNT_TYPES,
  INTEREST_TAGS,
  LOOKING_FOR,
  escapeHtml,
  timeAgo,
  formatEventDate,
  slugify,
  isAdultAge,
  membershipTiers: config.membership.tiers,
};
