import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import connectDB from './db/db.js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

let dbConnected = false;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const JWT_SECRET = process.env.JWT_SECRET;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));


// MongoDB Schemas
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: String,
  phone: { type: String, unique: true, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true, required: true },
  userId: String,
  items: [
    {
      id: String,
      name: String,
      carrier: String,
      data: String,
      price: Number,
      quantity: Number,
    }
  ],
  total: Number,
  currency: { type: String, default: 'GHS' },
  phone: String,
  email: String,
  name: String,
  status: {
    type: String,
    enum: ['pending_payment', 'pending', 'paid', 'completed', 'failed'],
    default: 'pending_payment'
  },
  paymentReference: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const bundleSchema = new mongoose.Schema({
  id: String,
  name: String,
  carrier: String,
  data: String,
  validity: String,
  price: Number,
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
const Bundle = mongoose.models.Bundle || mongoose.model('Bundle', bundleSchema);

// Middleware - Connect to DB on first request
app.use(async (req, res, next) => {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
      console.log('✅ MongoDB connected');
    } catch (err) {
      console.error('❌ MongoDB connection failed:', err.message);
      return res.status(503).json({ error: 'Database connection failed' });
    }
  }
  next();
});

app.use(cors());
app.use('/payment/webhook', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


// JWT Token Generation
function generateJWT(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

// JWT Verification Middleware
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Optional Token Verification
function optionalToken(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.userId = decoded.userId;
    } catch (err) {
      // Token invalid, continue without user
    }
  }
  next();
}

// Admin Token Verification
function verifyAdminToken(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No admin token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.isAdmin !== true) {
      return res.status(403).json({ error: 'Not an admin' });
    }
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Mailer Setup
function getMailer() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function safeSendMail(transport, options) {
  try {
    await transport.sendMail(options);
    console.log('✅ Email sent:', options.subject);
  } catch (err) {
    console.error('❌ Email failed:', err.message);
  }
}

function sendOrderEmail(order) {
  const transport = getMailer();
  if (!transport) return;

  const itemsText = (order.items || [])
    .map((i) => `• ${i.name} × ${i.quantity || 1} — GHS ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}`)
    .join('\n');

  const html = `
    <h2>New Order: ${order.orderId}</h2>
    <p><strong>Status:</strong> ${order.status || 'pending_payment'}</p>
    <p><strong>Customer:</strong> ${order.name || '—'}</p>
    <p><strong>Phone:</strong> ${order.phone || '—'}</p>
    <p><strong>Email:</strong> ${order.email || '—'}</p>
    <p><strong>Items:</strong></p>
    <pre>${itemsText}</pre>
    <p><strong>Total:</strong> GHS ${(order.total || 0).toFixed(2)}</p>
    <p><strong>Date:</strong> ${order.createdAt}</p>
  `;

  safeSendMail(transport, {
    from: GMAIL_USER,
    to: GMAIL_USER,
    subject: `[IdealDataHub] New Order ${order.orderId}`,
    html,
  });
}

function sendPaymentEmail(order, paymentId) {
  const transport = getMailer();
  if (!transport) return;

  const itemsText = (order.items || [])
    .map((i) => `• ${i.name} × ${i.quantity || 1} — GHS ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}`)
    .join('\n');

  const adminHtml = `
    <h2>💰 Payment Received</h2>
    <p><strong>Order ID:</strong> ${order.orderId}</p>
    <p><strong>Payment Ref:</strong> ${paymentId}</p>
    <p><strong>Customer:</strong> ${order.name}</p>
    <p><strong>Phone:</strong> ${order.phone}</p>
    <p><strong>Email:</strong> ${order.email}</p>
    <pre>${itemsText}</pre>
    <p><strong>Total:</strong> GHS ${order.total.toFixed(2)}</p>
  `;

  const customerHtml = `
    <h2>✅ Payment Successful</h2>
    <p>Hello ${order.name || 'Customer'},</p>
    <p>Your payment was successful.</p>
    <p><strong>Order ID:</strong> ${order.orderId}</p>
    <p><strong>Payment Reference:</strong> ${paymentId}</p>
    <pre>${itemsText}</pre>
    <p><strong>Total Paid:</strong> GHS ${order.total.toFixed(2)}</p>
    <p>Your data will be delivered shortly. Thank you for choosing IdealDataHub.</p>
  `;

  safeSendMail(transport, {
    from: GMAIL_USER,
    to: GMAIL_USER,
    subject: `[IdealDataHub] Payment Received — ${order.orderId}`,
    html: adminHtml,
  });

  if (order.email) {
    safeSendMail(transport, {
      from: GMAIL_USER,
      to: order.email,
      subject: `Payment Confirmation — ${order.orderId}`,
      html: customerHtml,
    });
  }
}

// Routes

// GET Bundles
app.get('/api/bundles', async (req, res) => {
  try {
    let query = {};
    const { carrier, validity } = req.query;

    if (carrier) query.carrier = carrier;
    if (validity) query.validity = new RegExp(validity, 'i');

    const bundles = await Bundle.find(query);
    res.json(bundles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bundles' });
  }
});

// GET Carriers
app.get('/api/carriers', (_req, res) => {
  res.json(['MTN', 'AirtelTigo', 'Telecel']);
});

// POST Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, phone } = req.body || {};

  if (!email || !password || !name || !phone) {
    return res.status(400).json({ error: 'Email, password, name and phone are required' });
  }

  const emailClean = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const phoneClean = String(phone).replace(/\s/g, '');
  if (!/^0\d{9}$/.test(phoneClean)) {
    return res.status(400).json({ error: 'Valid Ghana phone number (0XXXXXXXXX) required' });
  }

  try {
    const existingEmail = await User.findOne({ email: emailClean });
    if (existingEmail) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const existingPhone = await User.findOne({ phone: phoneClean });
    if (existingPhone) {
      return res.status(409).json({ error: 'An account with this phone number already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

    const user = new User({
      id: userId,
      email: emailClean,
      passwordHash,
      name: String(name).trim(),
      phone: phoneClean,
    });

    await user.save();

    const token = generateJWT(userId);

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const emailClean = String(email).trim().toLowerCase();

  try {
    const user = await User.findOne({ email: emailClean });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateJWT(user.id);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET Current User
app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.userId });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user: { id: user.id, email: user.email, name: user.name, phone: user.phone } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST Create Order
app.post('/api/order', optionalToken, async (req, res) => {
  const { items, phone, email, name } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const phoneClean = (phone || '').replace(/\s/g, '');
  if (!phoneClean || !/^0\d{9}$/.test(phoneClean)) {
    return res.status(400).json({ error: 'Valid Ghana phone number (0XXXXXXXXX) required' });
  }

  try {
    const bundles = await Bundle.find();
    const byId = Object.fromEntries(bundles.map(b => [b.id, b]));

    let total = 0;
    const orderItems = [];

    for (const { id, quantity = 1 } of items) {
      const b = byId[id];
      if (!b) continue;
      const q = Math.max(1, Math.floor(quantity));
      orderItems.push({ ...b.toObject(), quantity: q });
      total += b.price * q;
    }

    if (orderItems.length === 0) {
      return res.status(400).json({ error: 'No valid bundles in cart' });
    }

    const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    const order = new Order({
      orderId,
      items: orderItems,
      total: Math.round(total * 100) / 100,
      phone: phoneClean,
      email: email || null,
      name: name || null,
      status: 'pending_payment',
      userId: req.userId || null,
    });

    await order.save();
    sendOrderEmail(order);

    res.status(201).json({
      success: true,
      message: 'Order created. Proceed to payment.',
      order: order.toObject(),
    });
  } catch (err) {
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET Orders (by phone or admin)
app.get('/api/orders', async (req, res) => {
  const { phone } = req.query;
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;

  let isAdmin = false;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      isAdmin = decoded.isAdmin === true;
    } catch (err) {
      // Not an admin token
    }
  }

  try {
    if (isAdmin) {
      const orders = await Order.find().sort({ createdAt: -1 });
      return res.json(orders);
    }

    if (!phone || !/^0\d{9}$/.test(String(phone).replace(/\s/g, ''))) {
      return res.status(400).json({ error: 'Phone number required to view orders' });
    }

    const phoneClean = String(phone).replace(/\s/g, '');
    const orders = await Order.find({ phone: phoneClean }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET Account Orders
app.get('/api/account/orders', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.userId });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const orders = await Order.find({
      $or: [{ userId: req.userId }, { phone: user.phone }]
    }).sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET Single Order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// PATCH Update Order Status (Admin only)
app.patch('/api/orders/:id', verifyAdminToken, async (req, res) => {
  const { status } = req.body;
  const valid = ['pending_payment', 'pending', 'paid', 'completed', 'failed'];

  if (!status || !valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use: ' + valid.join(', ') });
  }

  try {
    const order = await Order.findOneAndUpdate(
      { orderId: req.params.id },
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// POST Admin Login
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  try {
    const isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ isAdmin: true, userId: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST Payment Initialize
app.post('/api/payment/initialize', async (req, res) => {
  const { orderId, email, amount } = req.body;

  if (!orderId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'orderId and amount required' });
  }

  if (!PAYSTACK_SECRET) {
    return res.status(503).json({ error: 'Payment not configured. Set PAYSTACK_SECRET_KEY.' });
  }

  try {
    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'pending_payment') {
      return res.status(400).json({ error: 'Order already processed' });
    }

    let baseUrl = req.headers.origin || req.headers.referer;
    try {
      baseUrl = baseUrl ? new URL(baseUrl).origin : null;
    } catch (_) {
      baseUrl = null;
    }
    if (!baseUrl) baseUrl = `http://localhost:${PORT}`;

    const callbackUrl = `${baseUrl}/payment/callback`;

    const payload = {
      email: email || order.email || `customer-${order.phone}@idealdata.gh`,
      amount: Math.round(Number(amount) * 100),
      currency: 'GHS',
      reference: orderId,
      callback_url: callbackUrl,
      channels: ['card', 'mobile_money', 'bank'],
      metadata: { orderId, phone: order.phone },
    };

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Paystack error' });
    }

    res.json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code
    });
  } catch (err) {
    console.error('Payment init error:', err);
    res.status(502).json({ error: 'Payment service error' });
  }
});

// Payment Webhook
app.post('/payment/webhook', async (req, res) => {
  if (!PAYSTACK_SECRET) return res.sendStatus(200);

  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(req.body)
    .digest('hex');

  if (hash !== signature) return res.sendStatus(200);

  try {
    const event = JSON.parse(req.body.toString());

    if (event.event === 'charge.success') {
      const ref = event.data.reference;
      const order = await Order.findOne({ orderId: ref });

      if (order && order.status === 'pending_payment') {
        order.status = 'paid';
        order.paymentReference = ref;
        order.updatedAt = new Date();
        await order.save();
        sendPaymentEmail(order, ref);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

// Payment Callback
app.get('/payment/callback', async (req, res) => {
  const ref = req.query.reference;

  if (!ref || !PAYSTACK_SECRET) {
    return res.redirect('/orders?payment=error');
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      }
    );

    const payload = await response.json();
    const tx = payload?.data;

    const order = await Order.findOne({ orderId: ref });

    if (order && tx) {
      if (tx.status === 'success') {
        order.status = 'paid';
        order.paymentReference = tx.reference;
        order.updatedAt = new Date();
        await order.save();
        sendPaymentEmail(order, tx.reference);
      } else if (['pending', 'ongoing', 'processing'].includes(tx.status)) {
        order.status = 'pending';
        order.updatedAt = new Date();
        await order.save();
      } else {
        order.status = 'failed';
        order.updatedAt = new Date();
        await order.save();
      }
    }

    if (tx?.status === 'success') {
      return res.redirect(`/orders?payment=success&order=${ref}`);
    }

    if (['pending', 'ongoing', 'processing'].includes(tx?.status)) {
      return res.redirect(`/orders?payment=processing&order=${ref}`);
    }

    return res.redirect(`/orders?payment=failed&order=${ref}`);
  } catch (err) {
    console.error('Verify error:', err);
    res.redirect('/orders?payment=error');
  }
});

// POST Contact
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required' });
  }

  const transport = getMailer();
  if (!transport) {
    return res.status(503).json({ error: 'Contact form is not configured. Please try again later.' });
  }

  const html = `
    <h2>Contact form — IdealData</h2>
    <p><strong>From:</strong> ${String(name).trim()}</p>
    <p><strong>Email:</strong> ${String(email).trim()}</p>
    <p><strong>Message:</strong></p>
    <pre>${String(message).trim()}</pre>
  `;

  safeSendMail(transport, {
    from: GMAIL_USER,
    to: GMAIL_USER,
    replyTo: String(email).trim(),
    subject: `[IdealData] Contact from ${String(name).trim()}`,
    html,
  }).then(() => {
    res.json({ success: true });
  }).catch((err) => {
    res.status(500).json({ error: 'Could not send message. Please try again.' });
  });
});

// Page Routes
app.get('/orders', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'orders.html'));
});
app.get('/auth', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'auth.html'));
});
app.get('/account', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'account.html'));
});
app.get('/contact', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'contact.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'admin.html'));
});
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

export default app;