import mongoose from 'mongoose';

/* Every email the app tried to send, and what happened to it. */
const notificationSchema = new mongoose.Schema({
  at:      { type: Date, default: Date.now },
  to:      { type: String, default: '' },          // address ('' when the trainer has none)
  trainer: { type: String, default: '' },
  subject: { type: String, default: '' },
  status:  { type: String, enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
  reason:  { type: String, default: '' },          // why it failed or was skipped
  context: { type: String, default: '' },          // e.g. "Batch AI Ready 2027 · Batch-1 updated"
  by:      { type: String, default: '' },          // who triggered it
}, { versionKey: false });

notificationSchema.index({ at: -1 });

export default mongoose.model('Notification', notificationSchema);
