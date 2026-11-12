require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ service: 'EasyPay', status: 'ok' }));
app.use(require('./src/payments'));

const PORT = process.env.PORT || 4000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/easypay')
  .then(() => app.listen(PORT, () => console.log(`EasyPay running on http://localhost:${PORT}`)))
  .catch((e) => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
