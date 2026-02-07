import dotenv from 'dotenv';
dotenv.config();
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import connectDB from '../db/db.js';

async function run() {
  try {
    await connectDB();
    console.log('✅ MongoDB connected');

    const bundlesPath = path.join(process.cwd(), 'data', 'bundles.json');
    const raw = fs.readFileSync(bundlesPath, 'utf8');
    const bundles = JSON.parse(raw);

    const bundleSchema = new mongoose.Schema({
      id: { type: String, unique: true, required: true },
      name: String,
      carrier: String,
      data: String,
      validity: String,
      price: Number,
      currency: { type: String, default: 'GHS' },
    });

    const Bundle = mongoose.models.Bundle || mongoose.model('Bundle', bundleSchema);

    let inserted = 0;
    for (const b of bundles) {
      if (!b.id) continue;
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
      inserted += 1;
    }

    console.log(`✅ Upserted ${inserted} bundles`);
  } catch (err) {
    console.error('❌ Import failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  }
}

run();
