// Creates a sandbox API user + key for your Collections subscription.
// Usage: put MTN_COLLECTION_KEY in .env, then run: npm run provision
require('dotenv').config();
const crypto = require('crypto');

const BASE = process.env.MTN_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const KEY = process.env.MTN_COLLECTION_KEY;
if (!KEY) { console.error('Set MTN_COLLECTION_KEY in .env first.'); process.exit(1); }

(async () => {
  const user = crypto.randomUUID();
  let r = await fetch(`${BASE}/v1_0/apiuser`, {
    method: 'POST',
    headers: { 'X-Reference-Id': user, 'Ocp-Apim-Subscription-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerCallbackHost: 'localhost' }),
  });
  if (r.status !== 201) { console.error('Create API user failed:', r.status, await r.text()); process.exit(1); }
  r = await fetch(`${BASE}/v1_0/apiuser/${user}/apikey`, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': KEY } });
  if (!r.ok) { console.error('Create API key failed:', r.status, await r.text()); process.exit(1); }
  const { apiKey } = await r.json();
  console.log('\nAdd these to your .env:\n');
  console.log(`MTN_API_USER=${user}`);
  console.log(`MTN_API_KEY=${apiKey}\n`);
})();
