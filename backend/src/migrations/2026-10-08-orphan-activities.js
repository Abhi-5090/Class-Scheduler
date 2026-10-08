/*
 * One-off: removes logged trainer activities the board can never show.
 *
 * Until the activities API learned to refuse them, work could be saved onto a
 * period the trainer already teaches (the "All Day" preset did it routinely).
 * A class always wins on the board, so those notes sat in the database unseen,
 * waiting to surface if the class ever moved. The same goes for notes left on
 * a day or period that is no longer in the grid, or for a trainer who no
 * longer exists.
 *
 *   node src/migrations/2026-10-08-orphan-activities.js          remove them
 *   node src/migrations/2026-10-08-orphan-activities.js --dry    list only
 *
 * Safe to run more than once.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../db.js';
import Activity from '../models/Activity.js';
import Batch from '../models/Batch.js';
import Config from '../models/Config.js';
import Trainer from '../models/Trainer.js';

const dry = process.argv.includes('--dry');

async function run() {
  await connectDB();

  const [config, trainers, batches, activities] = await Promise.all([
    Config.findOne({ key: 'default' }).lean(),
    Trainer.find({}, { name: 1 }).lean(),
    Batch.find({}, { name: 1, sessions: 1 }).lean(),
    Activity.find().lean(),
  ]);

  const known = new Set(trainers.map(t => t.name));
  const taught = new Map();                        // "trainer|day|slot" -> batch
  for (const b of batches) {
    for (const s of b.sessions || []) {
      for (const n of [...(s.mainTrainers || []), ...(s.supportTrainers || [])]) {
        for (const slot of s.slots || []) taught.set(`${n}|${s.day}|${slot}`, b.name);
      }
    }
  }

  const doomed = [];
  for (const a of activities) {
    const why = !known.has(a.trainer) ? 'trainer no longer exists'
      : !config.days.includes(a.day) ? 'day is not in the grid'
      : a.slot < 0 || a.slot >= config.slots.length ? 'period is not in the grid'
      : taught.has(`${a.trainer}|${a.day}|${a.slot}`) ? `under a class (${taught.get(`${a.trainer}|${a.day}|${a.slot}`)})`
      : null;
    if (why) {
      doomed.push(a._id);
      console.log(`  ${dry ? 'would remove' : 'remove'}  ${a.trainer} · ${a.day} slot ${a.slot + 1} · ${a.kind === 'lunch' ? 'Lunch' : a.label} — ${why}`);
    }
  }

  if (!dry && doomed.length) await Activity.deleteMany({ _id: { $in: doomed } });
  console.log(`\n  ${doomed.length} of ${activities.length} logged activities ${dry ? 'would be' : 'were'} removed.\n`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
