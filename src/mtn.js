// Thin adapter around the MTN MoMo Collections API.
const crypto = require('crypto');

const BASE = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const TARGET_ENV = process.env.MTN_TARGET_ENV || 'sandbox';
const SUB_KEY = process.env.MTN_COLLECTION_KEY;

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt - 30000) return cached.token;
  const basic = Buffer.from(`${process.env.MTN_API_USER}:${process.env.MTN_API_KEY}`).toString('base64');
  const res = await fetch(`${BASE}/collection/token/`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': SUB_KEY },
  });
  if (!res.ok) throw new Error(`MTN token request failed (${res.status}). Check MTN_API_USER / MTN_API_KEY / MTN_COLLECTION_KEY.`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${await getToken()}`,
    'X-Target-Environment': TARGET_ENV,
    'Ocp-Apim-Subscription-Key': SUB_KEY,
    ...extra,
  };
}

// Ask MTN to send a payment approval prompt to the payer's phone.
async function requestToPay({ amount, currency, payerPhone, externalId, payerMessage, payeeNote, callbackUrl }) {
  const referenceId = crypto.randomUUID();
  const extra = { 'X-Reference-Id': referenceId, 'Content-Type': 'application/json' };
  if (callbackUrl && callbackUrl.startsWith('https://')) extra['X-Callback-Url'] = callbackUrl;
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: await authHeaders(extra),
    body: JSON.stringify({
      amount: String(amount),
      currency,
      externalId: String(externalId),
      payer: { partyIdType: 'MSISDN', partyId: payerPhone },
      payerMessage: (payerMessage || 'Payment').slice(0, 160),
      payeeNote: (payeeNote || 'EasyPay').slice(0, 160),
    }),
  });
  if (res.status !== 202) {
    const text = await res.text();
    throw new Error(`MTN requesttopay failed (${res.status}): ${text}`);
  }
  return referenceId;
}

// -> { status: 'PENDING' | 'SUCCESSFUL' | 'FAILED', reason, financialTransactionId }
async function getPaymentStatus(referenceId) {
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay/${referenceId}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`MTN status check failed (${res.status})`);
  const d = await res.json();
  return { status: d.status, reason: d.reason, financialTransactionId: d.financialTransactionId };
}

// true / false, or null if MTN could not answer
async function isActive(msisdn) {
  try {
    const res = await fetch(`${BASE}/collection/v1_0/accountholder/msisdn/${msisdn}/active`, { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    return d.result === true || d.result === 'true';
  } catch { return null; }
}

// Registered name for a MoMo number, or null if unavailable.
async function getAccountName(msisdn) {
  try {
    const res = await fetch(`${BASE}/collection/v1_0/accountholder/msisdn/${msisdn}/basicuserinfo`, { headers: await authHeaders() });
    if (!res.ok) return null;
    const d = await res.json();
    const name = [d.given_name, d.family_name].filter(Boolean).join(' ').trim();
    return name || null;
  } catch { return null; }
}

module.exports = { requestToPay, getPaymentStatus, isActive, getAccountName };
