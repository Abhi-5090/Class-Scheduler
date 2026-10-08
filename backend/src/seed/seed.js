/*
 * Loads the initial schedule (initialData.json) into MongoDB.
 *
 *   npm run seed            upsert — safe to re-run, keeps anything you added
 *   npm run seed -- --fresh wipe the schedule collections first
 *
 * The admin account is not touched here; server.js seeds it from .env.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDB } from '../db.js';
import Config from '../models/Config.js';
import YearGroup from '../models/YearGroup.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'initialData.json'), 'utf8'));

/* Years with no batches yet still get a card on the board, so they are stored
   as pending groups rather than left out. */
const PENDING_GROUPS = [
  {
    name: 'Second Year',
    order: 3,
    pending: true,
    note: 'Batch allocation and trainer mapping are being finalised for this year group.',
  },
];

const fresh = process.argv.includes('--fresh');

async function run() {
  await connectDB();

  if (fresh) {
    await Promise.all([
      Config.deleteMany({}), YearGroup.deleteMany({}),
      Trainer.deleteMany({}), Venue.deleteMany({}), Batch.deleteMany({}),
    ]);
    console.log('  wiped   schedule collections');
  }

  await Config.findOneAndUpdate({ key: 'default' }, data.config, { upsert: true, new: true });
  console.log(`  config  ${data.config.slots.length} slots × ${data.config.days.length} days, lunch at ${data.config.slots[data.config.lunchIndex]}`);

  for (const g of [...data.groups, ...PENDING_GROUPS]) {
    await YearGroup.findOneAndUpdate({ name: g.name }, g, { upsert: true });
  }
  console.log(`  groups  ${data.groups.length} active + ${PENDING_GROUPS.length} pending`);

  for (const t of data.trainers) await Trainer.findOneAndUpdate({ name: t.name }, t, { upsert: true });
  console.log(`  trainers ${data.trainers.length}`);

  for (const v of data.venues) await Venue.findOneAndUpdate({ name: v.name }, v, { upsert: true });
  console.log(`  venues  ${data.venues.length}`);

  let sessions = 0;
  for (const [i, b] of data.batches.entries()) {
    const batchSessions = (b.sessions || []).map(s => ({
      ...s,
      venue: s.venue !== undefined ? s.venue : (b.venue || ''),
    }));
    await Batch.findOneAndUpdate(
      { name: b.name },
      { ...b, sessions: batchSessions, order: i },
      { upsert: true, new: true },
    );
    sessions += batchSessions.length;
  }
  console.log(`  batches ${data.batches.length} carrying ${sessions} sessions`);

  await mongoose.disconnect();
  console.log('\n  done. start the api with `npm run dev`\n');
}

run().catch(err => { console.error(err); process.exit(1); });
