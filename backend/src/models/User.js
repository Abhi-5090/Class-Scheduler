import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/*
 * Everyone who can sign in. Three roles, in order of reach:
 *   admin        — everything: accounts, change history, the period grid, settings
 *   coordinator  — builds the timetable: batches, sessions, assigned work,
 *                  holidays and exceptions, imports, notifications
 *   trainer      — reads their own timetable; linked to one Trainer record
 */
export const ROLES = ['admin', 'coordinator', 'trainer'];

const userSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true },
  name:         { type: String, default: '', trim: true, maxlength: 120 },
  role:         { type: String, enum: ROLES, default: 'coordinator' },
  /* the Trainer this account belongs to (trainer role only) — by id, so a
     rename of the trainer never breaks the link */
  trainer:      { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer', default: null },
  active:       { type: Boolean, default: true },
  /* bumped on every password change, role change or deactivation; a session
     token carrying an older number is refused, so those sign the user out */
  tokenVersion: { type: Number, default: 0 },
  /* set for accounts an admin created or reset: the temporary password must
     be replaced before anything else is allowed */
  mustChangePassword: { type: Boolean, default: false },
  lastLoginAt:  { type: Date, default: null },
}, { timestamps: true });

/* one account per trainer */
userSchema.index({ trainer: 1 }, { unique: true, partialFilterExpression: { trainer: { $type: 'objectId' } } });

userSchema.methods.verify = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hash = function (plain) {
  return bcrypt.hash(plain, 12);
};

export default mongoose.model('User', userSchema);
