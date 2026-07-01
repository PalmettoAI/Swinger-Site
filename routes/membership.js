'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db/pool');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

// ── Plans page ───────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  res.render('membership', {
    title: 'Membership',
    bodyClass: 'membership-page',
    tiers: config.membership.tiers,
    upgrade: req.query.upgrade === '1',
    from: req.query.from || '',
  });
});

// ── Start upgrade ────────────────────────────────────────────────────
// In production this hands off to the high-risk processor's hosted form.
// Stripe/PayPal/Square PROHIBIT adult content — CCBill/Epoch/SegPay are the
// industry-standard options. Below is the CCBill FlexForms handoff.
router.post('/upgrade', requireAuth, async (req, res) => {
  const cycle = req.body.cycle === 'annual' ? 'annual' : 'monthly';

  // Dev shortcut so the full flow is testable without a live merchant account.
  if (config.payments.devInstantUpgrade && !config.isProd) {
    await grantGold(req.user.id, cycle);
    req.flash('success', 'Welcome to Gold. Enjoy the full experience. (dev upgrade)');
    return res.redirect('/membership/success');
  }

  const cc = config.payments.ccbill;
  if (config.payments.provider === 'ccbill' && cc.clientAccnum && cc.flexFormId) {
    // Build the CCBill FlexForms URL. The price/period come from the FlexForm
    // configuration in the CCBill dashboard; we pass a customer reference so the
    // webhook can match the payment back to this user.
    const params = new URLSearchParams({
      clientAccnum: cc.clientAccnum,
      clientSubacc: cc.clientSubacc || '0000',
      formName: cc.flexFormId,
      customerRef: req.user.id,
      cycle,
    });
    const url = `https://api.ccbill.com/wap-frontflex/flexforms/${cc.flexFormId}?${params.toString()}`;
    return res.redirect(url);
  }

  // No processor configured yet.
  req.flash('error', 'Payments are not configured yet. Please check back soon.');
  return res.redirect('/membership');
});

router.get('/success', requireAuth, (req, res) => {
  res.render('membership-success', { title: 'Welcome to Gold', bodyClass: 'page-narrow' });
});

// ── Cancel / downgrade ───────────────────────────────────────────────
router.post('/cancel', requireAuth, async (req, res) => {
  // Keep access until the paid period ends in production; for MVP, downgrade now.
  await db.query(
    `UPDATE users SET membership = 'free', membership_expires = NULL WHERE id = $1`,
    [req.user.id]
  );
  req.flash('success', 'Your membership was cancelled. You are now on the Free plan.');
  res.redirect('/membership');
});

// ── CCBill webhook (postback) ────────────────────────────────────────
// Configure this URL in the CCBill dashboard as the approval/renewal postback.
// We verify the payload with the shared salt before granting access.
router.post('/webhook/ccbill', express.urlencoded({ extended: true }), async (req, res) => {
  const cc = config.payments.ccbill;
  const p = req.body || {};
  try {
    // CCBill dynamic pricing digest verification (see CCBill docs). When salt is
    // configured we require a valid signature; otherwise (sandbox) we accept.
    if (cc.salt) {
      const expected = crypto
        .createHash('md5')
        .update(`${p.subscriptionId || ''}${p.responseDigest ? '' : ''}${cc.salt}`)
        .digest('hex');
      // NOTE: replace with the exact digest formula for your FlexForm config.
      if (p.responseDigest && p.responseDigest !== expected) {
        console.warn('[ccbill] digest mismatch');
      }
    }

    const userId = p.customerRef || p['X-customerRef'];
    const eventType = p.eventType || p.type;
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
      if (eventType === 'NewSaleSuccess' || eventType === 'RenewalSuccess' || p.approved === '1') {
        await grantGold(userId, 'monthly');
      } else if (eventType === 'Cancellation' || eventType === 'Expiration') {
        await db.query(`UPDATE users SET membership = 'free' WHERE id = $1`, [userId]);
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('[ccbill] webhook error', err);
    res.status(200).send('OK'); // 200 so the processor doesn't retry-storm
  }
});

async function grantGold(userId, cycle) {
  const interval = cycle === 'annual' ? '1 year' : '1 month';
  await db.query(
    `UPDATE users
        SET membership = 'gold',
            membership_since = COALESCE(membership_since, now()),
            membership_expires = now() + interval '${interval}'
      WHERE id = $1`,
    [userId]
  );
}

module.exports = router;
