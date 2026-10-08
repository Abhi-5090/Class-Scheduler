import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const adminSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name:         { type: String, default: 'Administrator' },
  /* bumped on every password change; a session token carrying an older
     number is refused, so changing the password signs out every device */
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });

adminSchema.methods.verify = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

adminSchema.statics.hash = function (plain) {
  return bcrypt.hash(plain, 12);
};

export default mongoose.model('Admin', adminSchema);
