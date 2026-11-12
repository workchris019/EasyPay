const mongoose = require('mongoose');
const crypto = require('crypto');

const merchantSchema = new mongoose.Schema({
  name: { type: String, required: true },          // business name shown at checkout
  momoNumber: { type: String, required: true },    // where the money goes (MSISDN or MoMo code)
  apiKey: { type: String, required: true, unique: true },
  webhookUrl: String,
  webhookSecret: String,
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  _id: { type: String, default: () => crypto.randomUUID() },
  merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  description: String,
  externalRef: String,                              // the host app's order/invoice id
  returnUrl: String,
  status: { type: String, enum: ['CREATED', 'PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED'], default: 'CREATED' },
  payerPhone: String,
  recipientName: String,
  recipientVerified: { type: Boolean, default: false },
  mtnReferenceId: String,
  mtnTransactionId: String,
  failureReason: String,
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 60 * 1000) },
}, { timestamps: true });

module.exports = {
  Merchant: mongoose.model('Merchant', merchantSchema),
  Payment: mongoose.model('Payment', paymentSchema),
};
