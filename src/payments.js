const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Merchant, Payment } = require('./models');
const mtn = require('./mtn');

const router = express.Router();
const CURRENCY = process.env.MTN_CURRENCY || 'EUR';
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

// "078 123 4567" / "+250781234567" -> "250781234567". Other digit strings (sandbox test numbers) pass through.
function normalizePhone(input) {
  const d = String(input || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return '250' + d.slice(1);
  if (d.length === 9) return '250' + d;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

async function notifyMerchant(payment) {
  const merchant = await Merchant.findById(payment.merchant);
  if (!merchant || !merchant.webhookUrl) return;
  const body = JSON.stringify({
    event: payment.status === 'SUCCESSFUL' ? 'payment.succeeded' : 'payment.failed',
    paymentId: payment._id,
    externalRef: payment.externalRef,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  });
  const sig = crypto.createHmac('sha256', merchant.webhookSecret || '').update(body).digest('hex');
  try {
    await fetch(merchant.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EasyPay-Signature': sig },
      body,
    });
  } catch (e) { console.error('Webhook failed:', e.message); }
}

// Ask MTN where the payment stands and update it once (atomic, so the webhook fires only once).
async function refresh(payment) {
  if (payment.status === 'CREATED' && payment.expiresAt < new Date()) {
    payment.status = 'EXPIRED';
    await payment.save();
    return payment;
  }
  if (payment.status !== 'PENDING' || !payment.mtnReferenceId) return payment;
  const r = await mtn.getPaymentStatus(payment.mtnReferenceId);
  if (r.status !== 'SUCCESSFUL' && r.status !== 'FAILED') return payment;
  const updated = await Payment.findOneAndUpdate(
    { _id: payment._id, status: 'PENDING' },
    { status: r.status, failureReason: r.reason, mtnTransactionId: r.financialTransactionId },
    { new: true }
  );
  if (updated) { notifyMerchant(updated); return updated; }
  return Payment.findById(payment._id);
}

// ---------- For host applications (API key required) ----------
async function auth(req, res, next) {
  const key = req.get('x-api-key');
  const merchant = key && await Merchant.findOne({ apiKey: key });
  if (!merchant) return res.status(401).json({ error: 'Invalid or missing x-api-key' });
  req.merchant = merchant;
  next();
}

const view = (p) => ({
  id: p._id, status: p.status, amount: p.amount, currency: p.currency,
  externalRef: p.externalRef, failureReason: p.failureReason, mtnTransactionId: p.mtnTransactionId,
});

router.post('/v1/payments', auth, async (req, res) => {
  const { amount, description, externalRef, returnUrl } = req.body || {};
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'amount must be a number greater than 0' });
  const payment = await Payment.create({
    merchant: req.merchant._id, amount: Number(amount), currency: CURRENCY,
    description, externalRef, returnUrl,
  });
  res.status(201).json({ ...view(payment), checkoutUrl: `${PUBLIC_URL}/checkout/${payment._id}` });
});

router.get('/v1/payments/:id', auth, async (req, res) => {
  const p = await Payment.findOne({ _id: req.params.id, merchant: req.merchant._id });
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  res.json(view(await refresh(p)));
});

// ---------- For the checkout page (public, protected by the unguessable payment id) ----------
router.get('/checkout/:id', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'checkout.html')));

async function loadPublic(req, res) {
  const p = await Payment.findById(req.params.id).catch(() => null);
  if (!p) { res.status(404).json({ error: 'Payment not found' }); return null; }
  return p;
}

router.get('/public/payments/:id', async (req, res) => {
  const p = await loadPublic(req, res); if (!p) return;
  const m = await Merchant.findById(p.merchant);
  const fresh = await refresh(p);
  res.json({
    status: fresh.status, amount: fresh.amount, currency: fresh.currency,
    description: fresh.description, merchantName: m.name, returnUrl: fresh.returnUrl,
  });
});

// Step 1: payer types their number and taps Send. We return where the money is going.
router.post('/public/payments/:id/prepare', async (req, res) => {
  const p = await loadPublic(req, res); if (!p) return;
  if (p.status !== 'CREATED') return res.status(409).json({ error: `This payment is ${p.status.toLowerCase()}.` });
  if (p.expiresAt < new Date()) { await refresh(p); return res.status(410).json({ error: 'This payment link has expired.' }); }

  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid MoMo phone number.' });
  if ((await mtn.isActive(phone)) === false) return res.status(400).json({ error: 'That number is not registered on MoMo.' });

  const m = await Merchant.findById(p.merchant);
  const registeredName = await mtn.getAccountName(m.momoNumber);
  p.payerPhone = phone;
  p.recipientName = registeredName || m.name;
  p.recipientVerified = !!registeredName;
  await p.save();

  res.json({
    amount: p.amount, currency: p.currency, payerPhone: phone,
    recipient: { name: p.recipientName, number: m.momoNumber, verified: p.recipientVerified },
  });
});

// Step 2: payer confirms. We trigger the MoMo approval prompt on their phone.
router.post('/public/payments/:id/confirm', async (req, res) => {
  const p = await loadPublic(req, res); if (!p) return;
  if (p.status !== 'CREATED' || !p.payerPhone) return res.status(409).json({ error: 'Start the payment again.' });
  const m = await Merchant.findById(p.merchant);
  try {
    const ref = await mtn.requestToPay({
      amount: p.amount, currency: p.currency, payerPhone: p.payerPhone,
      externalId: p._id, payerMessage: `Pay ${m.name}`, payeeNote: p.description || p.externalRef,
      callbackUrl: `${PUBLIC_URL}/mtn/callback/${p._id}`,
    });
    p.mtnReferenceId = ref;
    p.status = 'PENDING';
    await p.save();
    res.json({ status: 'PENDING' });
  } catch (e) {
    console.error(e.message);
    res.status(502).json({ error: 'Could not reach MoMo. Try again in a moment.' });
  }
});

router.get('/public/payments/:id/status', async (req, res) => {
  const p = await loadPublic(req, res); if (!p) return;
  try { res.json({ status: (await refresh(p)).status }); }
  catch { res.json({ status: p.status }); }
});

// MTN callback: we never trust its body, we just re-check the status with MTN.
router.put('/mtn/callback/:id', async (req, res) => {
  const p = await Payment.findById(req.params.id).catch(() => null);
  if (p) refresh(p).catch((e) => console.error(e.message));
  res.sendStatus(200);
});

module.exports = router;
