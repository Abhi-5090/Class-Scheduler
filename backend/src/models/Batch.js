import mongoose from 'mongoose';

/* Trainers and the venue are held by name rather than by ObjectId: the board
   is keyed on names everywhere, and a rename is a deliberate admin action that
   the rename cascade in routes/trainers.js and routes/venues.js keeps in step. */
const sessionSchema = new mongoose.Schema({
  day:             { type: String, required: true },
  slots:           { type: [Number], required: true },   // indexes into Config.slots
  subject:         { type: String, required: true, trim: true },
  venue:           { type: String, default: '' },        // Venue.name, '' = unassigned — per session, not per batch, since a batch can meet in different halls on different days
  mainTrainers:    { type: [String], default: [] },
  supportTrainers: { type: [String], default: [] },
  startDate:       { type: String, default: '' },        // Optional tentative start date (YYYY-MM-DD)
  endDate:         { type: String, default: '' },        // Optional tentative end date (YYYY-MM-DD)
}, { _id: true });

const batchSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true, trim: true },
  group:     { type: String, required: true },            // YearGroup.name
  dept:      { type: String, default: '' },
  count:     { type: Number, default: 0 },
  order:     { type: Number, default: 0 },
  startDate: { type: String, default: '' },               // Tentative start date for training (YYYY-MM-DD)
  endDate:   { type: String, default: '' },               // Tentative end date for training (YYYY-MM-DD)
  sessions:  { type: [sessionSchema], default: [] },
}, { timestamps: true });

/* the rename/delete cascades and the clash checks look sessions up by these */
batchSchema.index({ 'sessions.mainTrainers': 1 });
batchSchema.index({ 'sessions.supportTrainers': 1 });
batchSchema.index({ 'sessions.venue': 1 });
batchSchema.index({ group: 1 });

export default mongoose.model('Batch', batchSchema);
