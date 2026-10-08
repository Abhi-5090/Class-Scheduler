import { Router } from 'express';
import Config from '../models/Config.js';
import YearGroup from '../models/YearGroup.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';
import Activity from '../models/Activity.js';
import Exception from '../models/Exception.js';
import { today } from '../services/dates.js';
import { addDays } from '../services/occurrences.js';
import { buildSchedule } from '../services/derive.js';
import { wrap } from '../middleware/asyncRoute.js';

const router = Router();

export async function loadSchedule() {
  const [config, groups, trainers, venues, batches, activities] = await Promise.all([
    Config.findOne({ key: 'default' }).lean(),
    YearGroup.find().sort({ order: 1 }).lean(),
    Trainer.find({ active: true }).sort({ name: 1 }).lean(),
    Venue.find({ active: true }).sort({ name: 1 }).lean(),
    Batch.find().sort({ order: 1, name: 1 }).lean(),
    Activity.find().lean(),
  ]);

  if (!config) throw Object.assign(new Error('Schedule is not initialised — run `npm run seed`'), { status: 503 });

  return buildSchedule({ config, groups, trainers, venues, batches, activities });
}

/* Public. This is what the board reads — no auth, everybody sees the schedule.
   Holidays and class exceptions from two months back to a year ahead ride
   along for the calendar, with only the fields a visitor needs. */
/* The board is public and unauthenticated, so its answer is kept for a few
   seconds instead of rebuilt from every collection on every request; any
   successful change made through the console clears it at once (server.js). */
const TTL_MS = 15000;
let cached = null;          // { at, body }
export const invalidateSchedule = () => { cached = null; };

router.get('/', wrap(async (_req, res) => {
  if (cached && Date.now() - cached.at < TTL_MS) return res.json(cached.body);
  const on = today();
  const [data, exceptions] = await Promise.all([
    loadSchedule(),
    Exception.find({ date: { $lte: addDays(on, 366) }, $or: [{ date: { $gte: addDays(on, -62) } }, { endDate: { $gte: addDays(on, -62) } }] },
      { type: 1, date: 1, endDate: 1, label: 1, batch: 1, sessionId: 1, day: 1, slots: 1, subject: 1, fromTrainer: 1, toTrainer: 1 }).sort({ date: 1 }).lean(),
  ]);
  const body = { ...data, exceptions: exceptions.map(({ _id, sessionId, ...e }) => ({ id: String(_id), sessionId: sessionId ? String(sessionId) : null, ...e })) };
  cached = { at: Date.now(), body };
  res.json(body);
}));

export default router;
