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
const ADMIN_PASSWORD_HASH = (process.env.ADMIN_PASSWORD_HASH || '').trim();
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const PAYSTACK_SECRET = (process.env.PAYSTACK_SECRET_KEY || '').trim();
const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();

const fetch = global.fetch;

const MAINTENANCE_NOTICE = 'MTN orders are temporarily unavailable because the MTN server is under maintenance. You can place orders for AirtelTigo and Telecel only.';
const BLOCKED_CARRIERS = new Set(['MTN']);
const SESSION_TTL_MS = 1000 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_WINDOW_MS = 1000 * 60 * 15;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 60;
const AUTH_RATE_LIMITS = new Map();

function isCarrierBlocked(carrier) {
  return BLOCKED_CARRIERS.has(String(carrier || '').trim());
}

function isStrongPassword(password) {
  return typeof password === 'string' && password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || 'unknown').split(',')[0].trim();
}

function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const existing = AUTH_RATE_LIMITS.get(key);

  if (!existing) {
    AUTH_RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.resetAt <= now) {
    AUTH_RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true };
}

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true, lowercase: true },
  passwordHash: { type: String, required: true },
  name: String,
  phone: { type: String, unique: true, required: true },
  walletBalance: { type: Number, default: 0 },
  walletCurrency: { type: String, default: 'GHS' },
  lastLoginAt: Date,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  passwordResetToken: String,
  passwordResetExpiresAt: Date,
  sessionExpiresAt: Date,
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

const topupSchema = new mongoose.Schema({
  topupId: { type: String, unique: true, required: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  status: {
    type: String,
    enum: ['pending_payment', 'pending', 'paid', 'completed', 'failed'],
    default: 'pending_payment'
  },
  paymentReference: String,
  provider: { type: String, enum: ['paystack', 'manual'], default: 'paystack' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const walletTxSchema = new mongoose.Schema({
  txId: { type: String, unique: true, required: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'GHS' },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  reference: String,
  meta: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
const Bundle = mongoose.models.Bundle || mongoose.model('Bundle', bundleSchema);
const Topup = mongoose.models.Topup || mongoose.model('Topup', topupSchema);
const WalletTx = mongoose.models.WalletTx || mongoose.model('WalletTx', walletTxSchema);

// Middleware - Connect to DB on first request and import bundles if empty
app.use(async (req, res, next) => {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
      console.log('✅ MongoDB connected');

      try {
        const count = await Bundle.countDocuments();
        if (!count) {
          const bundlesPath = path.join(__dirname, 'data', 'bundles.json');
          console.log('📁 bundles collection empty — importing from', bundlesPath);
          const raw = fs.readFileSync(bundlesPath, 'utf8');
          const bundles = JSON.parse(raw || '[]');
          let upserted = 0;
          for (const b of bundles) {
            if (!b || !b.id) continue;
            const doc = {
              id: String(b.id),
              name: b.name || null,
              carrier: b.carrier || null,
              data: b.data || null,
              validity: b.validity || null,
              price: typeof b.price === 'number' ? b.price : Number(b.price || 0),
              currency: b.currency || 'GHS',
            };
            await Bundle.updateOne({ id: doc.id }, { $set: doc }, { upsert: true });
            upserted += 1;
          }
          console.log(`✅ Imported ${upserted} bundles into DB`);
        }
      } catch (impErr) {
        console.error('❌ Bundles import failed at runtime:', impErr?.message || impErr);
      }

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
function generateJWT(userId, expiresIn = '1h') {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn });
}

// DEBUG: Check admin hash on Vercel
app.get('/api/admin/debug', (req, res) => {
  res.json({
    hashSet: !!ADMIN_PASSWORD_HASH,
    hashLength: ADMIN_PASSWORD_HASH?.length,
    hashFirst20: ADMIN_PASSWORD_HASH?.substring(0, 20) + '...',
    timestamp: new Date().toISOString(),
  });
});

// JWT Verification Middleware
async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findOne({ id: decoded.userId });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.sessionExpiresAt && new Date(user.sessionExpiresAt) < new Date()) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

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

function cleanPhone(phone) {
  return String(phone || '').replace(/\s/g, '');
}

function isValidPhone(phone) {
  const clean = cleanPhone(phone);
  return /^0\d{9}$/.test(clean);
}

function getCarrierFromPhone(phone) {
  const clean = cleanPhone(phone);
  if (!/^0\d{9}$/.test(clean)) return null;
  const prefix = clean.substring(0, 3);

  if (['024','025','053', '054', '055', '059'].includes(prefix)) return 'MTN';
  if (['027', '057', '026', '056'].includes(prefix)) return 'AirtelTigo';
  if (['023', '050','020'].includes(prefix)) return 'Telecel';

  return null;
}

function isValidPhoneForCarrier(phone, carrier) {
  return getCarrierFromPhone(phone) === carrier;
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
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error('Mailer configuration missing: GMAIL_USER or GMAIL_APP_PASSWORD is not set');
    return null;
  }

  if (GMAIL_APP_PASSWORD.length !== 16) {
    console.warn('Mailer configuration warning: GMAIL_APP_PASSWORD should be 16 characters after normalization. Current length:', GMAIL_APP_PASSWORD.length);
  }

  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  return transport;
}

async function safeSendMail(transport, options) {
  try {
    await transport.sendMail(options);
    console.log('✅ Email sent:', options.subject);
    return true;
  } catch (err) {
    console.error('❌ Email failed:', err?.message || err);
    return false;
  }
}

function sendOrderEmail(order) {
  const transport = getMailer();
  if (!transport) return;

  const itemsText = (order.items || [])
    .map((i) => `• ${i.name} (${i.carrier || 'Unknown'}) × ${i.quantity || 1} — GHS ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}`)
    .join('\n');

  const carriers = [...new Set((order.items || []).map((i) => i.carrier).filter(Boolean))].join(', ') || 'Unknown';

  const html = `
    <h2>New Order: ${order.orderId}</h2>
    <p><strong>Status:</strong> ${order.status || 'pending_payment'}</p>
    <p><strong>Customer:</strong> ${order.name || '—'}</p>
    <p><strong>Phone:</strong> ${order.phone || '—'}</p>
    <p><strong>Email:</strong> ${order.email || '—'}</p>
    <p><strong>Carrier(s):</strong> ${carriers}</p>
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
    .map((i) => `• ${i.name} (${i.carrier || 'Unknown'}) × ${i.quantity || 1} — GHS ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}`)
    .join('\n');

  const carriers = [...new Set((order.items || []).map((i) => i.carrier).filter(Boolean))].join(', ') || 'Unknown';

  const adminHtml = `
    <h2>💰 Payment Received</h2>
    <p><strong>Order ID:</strong> ${order.orderId}</p>
    <p><strong>Payment Ref:</strong> ${paymentId}</p>
    <p><strong>Customer:</strong> ${order.name}</p>
    <p><strong>Phone:</strong> ${order.phone}</p>
    <p><strong>Email:</strong> ${order.email}</p>
    <p><strong>Carrier(s):</strong> ${carriers}</p>
    <pre>${itemsText}</pre>
    <p><strong>Total:</strong> GHS ${order.total.toFixed(2)}</p>
  `;

  const customerHtml = `
    <h2>✅ Payment Successful</h2>
    <p>Hello ${order.name || 'Customer'},</p>
    <p>Your payment was successful.</p>
    <p><strong>Order ID:</strong> ${order.orderId}</p>
    <p><strong>Payment Reference:</strong> ${paymentId}</p>
    <p><strong>Carrier(s):</strong> ${carriers}</p>
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

function sendTopupEmail(user, topup) {
  const transport = getMailer();
  if (!transport) return;

  const html = `
    <h2>Wallet Top-up Successful</h2>
    <p>Hello ${user.name || 'Customer'},</p>
    <p>Your wallet has been credited with <strong>GHS ${topup.amount.toFixed(2)}</strong>.</p>
    <p><strong>Top-up ID:</strong> ${topup.topupId}</p>
    <p><strong>Payment Reference:</strong> ${topup.paymentReference || 'N/A'}</p>
    <p>Your new balance is <strong>GHS ${user.walletBalance.toFixed(2)}</strong>.</p>
    <p>Thank you for using IdealDataHub.</p>
  `;

  safeSendMail(transport, {
    from: GMAIL_USER,
    to: user.email || GMAIL_USER,
    subject: `[IdealDataHub] Wallet Top-up — ${topup.topupId}`,
    html,
  });
}

async function creditUserWallet(userId, amount, options = {}) {
  const user = await User.findOne({ id: userId });
  if (!user) return null;

  const creditAmount = Math.round((amount || 0) * 100) / 100;
  user.walletBalance = Math.round(((user.walletBalance || 0) + creditAmount) * 100) / 100;
  user.updatedAt = new Date();
  await user.save();

  // record wallet transaction (credit)
  try {
    const tx = new WalletTx({
      txId: 'WAL-C-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      userId: user.id,
      amount: creditAmount,
      type: 'credit',
      reference: options.paymentReference || options.topupId || null,
      meta: options.meta || null,
    });
    await tx.save();
  } catch (err) {
    console.error('Failed to record wallet credit tx', err);
  }

  if (options.topupId) {
    await Topup.findOneAndUpdate(
      { topupId: options.topupId },
      {
        $set: {
          status: 'completed',
          paymentReference: options.paymentReference || options.paymentReference,
          updatedAt: new Date(),
        },
      }
    );
  }

  return user;
}

// Routes

// GET Bundles
app.get('/api/bundles', async (req, res) => {
  try {
    const query = {};
    const { carrier, validity } = req.query;

    if (carrier) {
      if (carrier === 'MTN') {
        return res.json([]);
      }
      query.carrier = carrier;
    } else {
      query.carrier = { $ne: 'MTN' };
    }

    if (validity) query.validity = new RegExp(validity, 'i');

    const bundles = await Bundle.find(query);
    res.json(bundles);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load bundles' });
  }
});

// GET Carriers
app.get('/api/carriers', (_req, res) => {
  res.json(['AirtelTigo', 'Telecel']);
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

  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, and a number' });
  }

  const phoneClean = String(phone).replace(/\s/g, '');
  if (!/^0\d{9}$/.test(phoneClean)) {
    return res.status(400).json({ error: 'Valid Ghana phone number (0XXXXXXXXX) required' });
  }

  const ipKey = `signup:${getClientIp(req)}:${emailClean}`;
  const rateLimit = enforceRateLimit(ipKey, 5, 1000 * 60 * 15);
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: 'Too many signup attempts. Please try again later.' });
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
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const user = new User({
      id: userId,
      email: emailClean,
      passwordHash,
      name: String(name).trim(),
      phone: phoneClean,
      sessionExpiresAt: expiresAt,
    });

    await user.save();

    const token = generateJWT(userId);

    res.status(201).json({
      token,
      expiresAt: expiresAt.toISOString(),
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
  const ipKey = `login:${getClientIp(req)}:${emailClean}`;
  const rateLimit = enforceRateLimit(ipKey, 8, 1000 * 60 * 15);
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  try {
    const user = await User.findOne({ email: emailClean });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      return res.status(423).json({ error: 'Account temporarily locked due to too many failed attempts. Please try again later.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOGIN_LOCK_WINDOW_MS);
      }
      user.updatedAt = new Date();
      await user.save();
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.loginAttempts = 0;
    user.lockUntil = null;
    user.lastLoginAt = new Date();
    user.sessionExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    user.updatedAt = new Date();
    await user.save();

    const token = generateJWT(user.id);

    res.json({
      token,
      expiresAt: user.sessionExpiresAt.toISOString(),
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  console.log('Forgot password request received:', { email });
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const emailClean = String(email).trim().toLowerCase();
  const ipKey = `forgot:${getClientIp(req)}:${emailClean}`;
  const rateLimit = enforceRateLimit(ipKey, 3, 1000 * 60 * 15);
  if (!rateLimit.allowed) {
    console.log('Forgot password rate limit reached for:', emailClean);
    return res.status(429).json({ error: 'Too many password reset requests. Please try again later.' });
  }

  try {
    const user = await User.findOne({ email: emailClean });
    if (!user) {
      return res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    user.updatedAt = new Date();
    await user.save();

    const resetUrl = `${req.protocol}://${req.get('host')}/pages/reset-password.html?token=${token}`;
    const transport = getMailer();
    if (!transport) {
      console.error('Forgot password error: missing mailer configuration');
      return res.status(500).json({ error: 'Email service is not configured. Please contact support.' });
    }

    try {
      await transport.verify();
      console.log('Mailer verified successfully');
    } catch (verifyErr) {
      console.error('Forgot password error: mail transport verification failed:', verifyErr?.message || verifyErr);
      return res.status(500).json({ error: 'Email service is unavailable. Please try again later.' });
    }

    const sent = await safeSendMail(transport, {
      from: GMAIL_USER,
      to: user.email,
      subject: '[IdealDataHub] Password Reset',
      html: `<p>Hello ${user.name || 'there'},</p><p>Use the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
    });

    if (!sent) {
      user.passwordResetToken = null;
      user.passwordResetExpiresAt = null;
      user.updatedAt = new Date();
      await user.save();
      console.error('Password reset email failed for user:', user.email);
      return res.status(500).json({ error: 'Failed to send password reset email. Please try again later.' });
    }

    console.log(`Password reset email queued for ${user.email}`);
    console.log(`Reset URL: ${resetUrl}`);
    res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.', resetUrl });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to send password reset instructions' });
  }
});

// POST Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include uppercase, lowercase, and a number' });
  }

  try {
    const user = await User.findOne({ passwordResetToken: token });
    if (!user || !user.passwordResetExpiresAt || new Date() > user.passwordResetExpiresAt) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    user.passwordHash = passwordHash;
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    user.loginAttempts = 0;
    user.lockUntil = null;
    user.updatedAt = new Date();
    await user.save();

    res.json({ success: true, message: 'Password reset successfully. Please sign in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
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
app.post('/api/order', verifyToken, async (req, res) => {
  const { items, phone, email, name } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  const phoneClean = cleanPhone(phone);
  if (!phoneClean || !isValidPhone(phoneClean)) {
    return res.status(400).json({ error: 'Valid Ghana phone number (0XXXXXXXXX) required' });
  }

  const phoneCarrier = getCarrierFromPhone(phoneClean);
  if (!phoneCarrier) {
    return res.status(400).json({ error: 'Invalid Ghana phone number prefix' });
  }

  if (phoneCarrier === 'MTN') {
    return res.status(403).json({ error: MAINTENANCE_NOTICE });
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

    const cartCarriers = [...new Set(orderItems.map((item) => item.carrier).filter(Boolean))];
    for (const carrier of cartCarriers) {
      if (isCarrierBlocked(carrier)) {
        return res.status(403).json({ error: MAINTENANCE_NOTICE });
      }
      if (!isValidPhoneForCarrier(phoneClean, carrier)) {
        return res.status(400).json({ error: `Invalid phone number for ${carrier} network. Please use a ${carrier} number.` });
      }
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
      const queryFilter = {};
      const q = String(req.query.q || '').trim();
      if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        queryFilter.$or = [
          { orderId: regex },
          { phone: regex },
          { email: regex },
          { name: regex },
        ];
      }
      const orders = await Order.find(queryFilter).sort({ createdAt: -1 });
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

// GET Wallet Data
app.get('/api/account/wallet', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.userId });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const topups = await Topup.find({ userId: req.userId }).sort({ createdAt: -1 });

    res.json({
      balance: user.walletBalance || 0,
      currency: user.walletCurrency || 'GHS',
      topups,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wallet data' });
  }
});

// POST Create Wallet Top-up
app.post('/api/wallet/topup', verifyToken, async (req, res) => {
  const amount = Number(req.body.amount);

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Top-up amount must be greater than zero' });
  }

  if (!PAYSTACK_SECRET) {
    return res.status(503).json({ error: 'Payment not configured. Set PAYSTACK_SECRET_KEY.' });
  }

  try {
    const user = await User.findOne({ id: req.userId });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const topupId = 'TOPUP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const topup = new Topup({
      topupId,
      userId: user.id,
      amount: Math.round(amount * 100) / 100,
      currency: 'GHS',
      status: 'pending_payment',
      provider: 'paystack',
    });

    await topup.save();

    let baseUrl = req.headers.origin || req.headers.referer;
    try {
      baseUrl = baseUrl ? new URL(baseUrl).origin : null;
    } catch (_) {
      baseUrl = null;
    }
    if (!baseUrl) baseUrl = `http://localhost:${PORT}`;

    const callbackUrl = `${baseUrl}/payment/callback`;
    const payload = {
      email: user.email || `customer-${user.phone}@idealdatahub.gh`,
      amount: Math.round(amount * 100),
      currency: 'GHS',
      reference: topupId,
      callback_url: callbackUrl,
      channels: ['card', 'mobile_money', 'bank'],
      metadata: { topupId, userId: user.id, type: 'wallet' },
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
      access_code: data.data.access_code,
      topup: topup.toObject(),
    });
  } catch (err) {
    console.error('Wallet topup error:', err);
    res.status(502).json({ error: 'Payment service error' });
  }
});

// POST Manual Wallet Credit (Admin only)
app.post('/api/wallet/manual', verifyAdminToken, async (req, res) => {
  const { userId, amount, note } = req.body;
  const value = Number(amount);

  if (!userId || !value || value <= 0) {
    return res.status(400).json({ error: 'userId and amount are required for manual credit' });
  }

  try {
    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const topupId = 'MANUAL-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const topup = new Topup({
      topupId,
      userId: user.id,
      amount: Math.round(value * 100) / 100,
      currency: 'GHS',
      status: 'completed',
      provider: 'manual',
      paymentReference: note ? String(note).slice(0, 100) : null,
    });

    await topup.save();
    await creditUserWallet(user.id, topup.amount, { topupId: topup.topupId, paymentReference: topup.paymentReference });

    res.json({ success: true, topup: topup.toObject() });
  } catch (err) {
    console.error('Manual wallet credit error:', err);
    res.status(500).json({ error: 'Failed to credit wallet' });
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

  if (!ADMIN_PASSWORD_HASH) {
    console.error('❌ ADMIN_PASSWORD_HASH not set in environment variables');
    return res.status(500).json({ error: 'Admin password not configured' });
  }

  try {
    console.log('🔐 Admin login attempt...');
    console.log('Hash length:', ADMIN_PASSWORD_HASH?.length, 'starts with:', ADMIN_PASSWORD_HASH?.substring(0, 10));
    
    const isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    
    console.log('✅ Bcrypt compare completed, valid:', isValid);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    if(!JWT_SECRET){
      console.error("JWT_SECRET not set");
      return res.status(500).json({error: 'JWT not configured'});
    }
    const token = jwt.sign({ isAdmin: true, userId: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } catch (err) {
    console.error('❌ Admin login error:', err?.message || err);
    console.error('Hash format check:', {
      hashExists: !!ADMIN_PASSWORD_HASH,
      hashLength: ADMIN_PASSWORD_HASH?.length,
      hashStart: ADMIN_PASSWORD_HASH?.substring(0, 15),
    });
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST Payment Initialize
app.post('/api/payment/initialize', async (req, res) => {
  const { orderId, email /*, amount */ } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'orderId required' });
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

    // use trusted total from database instead of value supplied by client
    const amountToCharge = Math.round(order.total * 100);

    let baseUrl = req.headers.origin || req.headers.referer;
    try {
      baseUrl = baseUrl ? new URL(baseUrl).origin : null;
    } catch (_) {
      baseUrl = null;
    }
    if (!baseUrl) baseUrl = `http://localhost:${PORT}`;

    const callbackUrl = `${baseUrl}/payment/callback`;

    const payload = {
      email: email || order.email || `customer-${order.phone}@idealdatahub.gh`,
      amount: amountToCharge,
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

// POST Pay order with wallet balance
app.post('/api/payment/wallet', verifyToken, async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  try {
    const user = await User.findOne({ id: req.userId });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // only allow wallet payment if order belongs to user or phone matches
    if (order.userId && order.userId !== user.id) {
      return res.status(403).json({ error: 'Order does not belong to user' });
    }

    if (order.phone && user.phone && order.userId !== user.id && order.phone !== user.phone) {
      return res.status(403).json({ error: 'Order phone does not match your account' });
    }

    if (order.status !== 'pending_payment') {
      return res.status(400).json({ error: 'Order is not awaiting payment' });
    }

    const total = Number(order.total || 0);
    if ((user.walletBalance || 0) < total) {
      return res.status(402).json({ error: 'Insufficient wallet balance' });
    }

    // deduct balance
    const debit = Math.round(total * 100) / 100;
    user.walletBalance = Math.round(((user.walletBalance || 0) - debit) * 100) / 100;
    user.updatedAt = new Date();
    await user.save();

    // record wallet debit tx
    const txId = 'WAL-D-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    try {
      const tx = new WalletTx({
        txId,
        userId: user.id,
        amount: debit,
        type: 'debit',
        reference: orderId,
        meta: { orderId },
      });
      await tx.save();
    } catch (err) {
      console.error('Failed to record wallet debit tx', err);
    }

    // mark order as paid
    order.status = 'paid';
    order.paymentReference = txId;
    order.updatedAt = new Date();
    await order.save();

    // notify
    sendPaymentEmail(order, txId);

    res.json({ success: true, order: order.toObject(), balance: user.walletBalance });
  } catch (err) {
    console.error('Wallet payment error:', err);
    res.status(500).json({ error: 'Failed to process wallet payment' });
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
      const topup = !order ? await Topup.findOne({ topupId: ref }) : null;

      if (order && order.status === 'pending_payment') {
        const amt = event.data.amount;
        const expected = Math.round(order.total * 100);
        if (amt === expected) {
          order.status = 'paid';
          order.paymentReference = ref;
          order.updatedAt = new Date();
          await order.save();
          sendPaymentEmail(order, ref);
        } else {
          console.warn('Webhook amount mismatch for', ref, amt, 'expected', expected);
        }
      } else if (topup && topup.status === 'pending_payment') {
        const amt = event.data.amount;
        const expected = Math.round(topup.amount * 100);
        if (amt === expected) {
          topup.status = 'paid';
          topup.paymentReference = ref;
          topup.updatedAt = new Date();
          await topup.save();

          const user = await creditUserWallet(topup.userId, topup.amount, {
            topupId: topup.topupId,
            paymentReference: ref,
          });
          if (user) sendTopupEmail(user, topup);
        } else {
          console.warn('Webhook topup amount mismatch for', ref, amt, 'expected', expected);
        }
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
    const topup = !order ? await Topup.findOne({ topupId: ref }) : null;

    if (order && tx) {
      const expected = Math.round(order.total * 100);
      if (tx.amount !== expected) {
        console.warn('Paystack amount mismatch for', ref, tx.amount, 'expected', expected);
      } else if (tx.status === 'success') {
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
    } else if (topup && tx) {
      const expected = Math.round(topup.amount * 100);
      if (tx.amount !== expected) {
        console.warn('Paystack amount mismatch for', ref, tx.amount, 'expected', expected);
      } else if (tx.status === 'success') {
        if (topup.status !== 'completed') {
          topup.status = 'completed';
          topup.paymentReference = tx.reference;
          topup.updatedAt = new Date();
          await topup.save();
          const user = await creditUserWallet(topup.userId, topup.amount, {
            topupId: topup.topupId,
            paymentReference: tx.reference,
          });
          if (user) sendTopupEmail(user, topup);
        }
      } else if (['pending', 'ongoing', 'processing'].includes(tx.status)) {
        if (topup.status !== 'completed') {
          topup.status = 'pending';
          topup.updatedAt = new Date();
          await topup.save();
        }
      } else {
        topup.status = 'failed';
        topup.updatedAt = new Date();
        await topup.save();
      }
    }

    if (tx?.status === 'success') {
      if (topup) {
        return res.redirect(`/account?deposit=success&topup=${ref}`);
      }
      return res.redirect(`/orders?payment=success&order=${ref}`);
    }

    if (['pending', 'ongoing', 'processing'].includes(tx?.status)) {
      if (topup) {
        return res.redirect(`/account?deposit=processing&topup=${ref}`);
      }
      return res.redirect(`/orders?payment=processing&order=${ref}`);
    }

    if (topup) {
      return res.redirect(`/account?deposit=failed&topup=${ref}`);
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

// app.listen(PORT, () => {
//   console.log(`Server is running at http://localhost:${PORT}`);
// })
export default app;