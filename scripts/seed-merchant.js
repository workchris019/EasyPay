// Registers an app/business that can use EasyPay.
// Usage: npm run seed -- "ShopEasy" 46733123450 https://yourapp.com/easypay-webhook
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Merchant } = require('../src/models');

const [name, momoNumber, webhookUrl] = process.argv.slice(2);
if (!name || !momoNumber) { console.error('Usage: npm run seed -- "<business name>" <momo number> [webhookUrl]'); process.exit(1); }

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/easypay');
  const m = await Merchant.create({
    name, momoNumber, webhookUrl,
    apiKey: 'epk_' + crypto.randomBytes(24).toString('hex'),
    webhookSecret: 'whsec_' + crypto.randomBytes(24).toString('hex'),
  });
  console.log('\nMerchant created. Keep these safe:\n');
  console.log('API key        :', m.apiKey);
  console.log('Webhook secret :', m.webhookSecret, '\n');
  await mongoose.disconnect();
})();
