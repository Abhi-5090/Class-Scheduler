import mongoose from 'mongoose';

/*
 * A change to one or more dates that the weekly template does not cover:
 *   holiday    — no classes at all from `date` to `endDate` (inclusive)
 *   cancel     — one class (batch + session) does not run on `date`
 *   substitute — on `date`, `toTrainer` takes `fromTrainer`'s place in one class
 * The weekly timetable is never edited by these; every date-based view
 * (calendar, finder, month PDF, today's status) applies them on top.
 */
export const EXCEPTION_TYPES = ['holiday', 'cancel', 'substitute'];

const exceptionSchema = new mongoose.Schema({
  type:        { type: String, enum: EXCEPTION_TYPES, required: true },
  date:        { type: String, required: true },          // YYYY-MM-DD
  endDate:     { type: String, default: '' },             // holidays may span days
  label:       { type: String, default: '', trim: true, maxlength: 200 },
  batchId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  batch:       { type: String, default: '' },             // batch name, kept in step on rename
  sessionId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  /* what the class looked like when the exception was made, for display */
  day:         { type: String, default: '' },
  slots:       { type: [Number], default: [] },
  subject:     { type: String, default: '' },
  fromTrainer: { type: String, default: '' },
  toTrainer:   { type: String, default: '' },
}, { timestamps: true });

exceptionSchema.index({ date: 1 });
exceptionSchema.index({ batchId: 1 });
/* one cancel-or-substitute decision per class per date */
exceptionSchema.index({ sessionId: 1, date: 1 }, { unique: true, partialFilterExpression: { sessionId: { $type: 'objectId' } } });

export default mongoose.model('Exception', exceptionSchema);
