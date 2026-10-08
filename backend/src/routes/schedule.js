import { Router } from 'express';
import Config from '../models/Config.js';
import YearGroup from '../models/YearGroup.js';
import Trainer from '../models/Trainer.js';
import Venue from '../models/Venue.js';
import Batch from '../models/Batch.js';
import Activity from '../models/Activity.js';
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

/* Public. This is what the board reads — no auth, everybody sees the schedule. */
router.get('/', wrap(async (_req, res) => {
  res.json(await loadSchedule());
}));

export default router;
