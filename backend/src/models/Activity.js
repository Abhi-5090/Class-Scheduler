import mongoose from 'mongoose';

/*
 * What a trainer is doing during a period that isn't a class — lunch taken
 * outside the standard break, or anything else (design work, social media,
 * requirements gathering...). One note per trainer/day/period; a real batch
 * session at that slot always takes precedence over this when the board is
 * rendered, so a note can never mask a class.
 */
const activitySchema = new mongoose.Schema({
  trainer: { type: String, required: true, trim: true },   // Trainer.name
  day:     { type: String, required: true },
  slot:    { type: Number, required: true },                // index into Config.slots
  kind:    { type: String, enum: ['lunch', 'other'], required: true },
  label:   { type: String, default: '', trim: true },       // free text, 'other' only
}, { timestamps: true });

activitySchema.index({ trainer: 1, day: 1, slot: 1 }, { unique: true });
activitySchema.index({ day: 1, slot: 1 });       // availability looks up by period

export default mongoose.model('Activity', activitySchema);
