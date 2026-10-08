import mongoose from 'mongoose';

/* One document, always. Holds the period grid every other view is drawn on. */
const configSchema = new mongoose.Schema({
  key:        { type: String, default: 'default', unique: true },
  slots:      { type: [String], required: true },
  days:       { type: [String], required: true },
  lunchIndex: { type: Number, default: 3 },
  /* bumped by every transaction that changes the timetable: two saves at the
     same moment both write this one document, so MongoDB makes one of them
     retry — and the retry re-runs its clash checks against the other's result */
  rev:        { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model('Config', configSchema);
