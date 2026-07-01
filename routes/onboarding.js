'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const geo = require('../lib/geo');
const { saveProfile } = require('../lib/saveProfile');
const { INTEREST_TAGS, LOOKING_FOR, ACCOUNT_TYPES } = require('../lib/helpers');

router.use(requireAuth);

router.get('/', async (req, res) => {
  // Pre-fill if a profile already exists (editing during onboarding).
  const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
  res.render('onboarding/index', {
    title: 'Set up your profile',
    bodyClass: 'onboarding',
    profile: rows[0] || {},
    accountType: req.user.account_type,
    accountTypes: ACCOUNT_TYPES,
    metros: geo.metroList(),
    interestTags: INTEREST_TAGS,
    lookingForOptions: LOOKING_FOR,
    formAction: '/onboarding',
    isEdit: false,
    error: null,
  });
});

router.post('/', async (req, res) => {
  const fail = (error) =>
    res.status(400).render('onboarding/index', {
      title: 'Set up your profile',
      bodyClass: 'onboarding',
      profile: req.body,
      accountType: req.user.account_type,
      accountTypes: ACCOUNT_TYPES,
      metros: geo.metroList(),
      interestTags: INTEREST_TAGS,
      lookingForOptions: LOOKING_FOR,
      formAction: '/onboarding',
      isEdit: false,
      error,
    });

  try {
    const result = await saveProfile(req.user, req.body);
    if (!result.ok) return fail(result.error);
    await db.query('UPDATE users SET onboarded = true WHERE id = $1', [req.user.id]);
    req.flash('success', 'Your profile is live. Add photos to stand out.');
    return res.redirect('/profile/photos');
  } catch (err) {
    console.error('[onboarding] save error', err);
    return fail('Something went wrong saving your profile. Please try again.');
  }
});

module.exports = router;
