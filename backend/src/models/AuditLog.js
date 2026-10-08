import mongoose from 'mongoose';

/*
 * The change history: one entry per create / update / delete / import /
 * sign-in, with who did it and what changed. Written in the same transaction
 * as the change itself wherever there is one, so the log and the data agree.
 */
const changeSchema = new mongoose.Schema({
  field: String,
  from:  String,
  to:    String,
}, { _id: false });

const auditSchema = new mongoose.Schema({
  at:       { type: Date, default: Date.now },
  actor:    {
    id:    { type: mongoose.Schema.Types.ObjectId, default: null },
    email: { type: String, default: '' },
    role:  { type: String, default: '' },
  },
  action:   { type: String, required: true },   // create | update | delete | import | login | login_failed | password | notify | config
  entity:   { type: String, required: true },   // batch | trainer | venue | group | config | activity | exception | user | auth | import
  entityId: { type: String, default: '' },
  name:     { type: String, default: '' },      // human label of the thing changed
  summary:  { type: String, default: '' },
  changes:  { type: [changeSchema], default: [] },
  ip:       { type: String, default: '' },
}, { versionKey: false });

auditSchema.index({ at: -1 });
auditSchema.index({ entity: 1, at: -1 });
auditSchema.index({ 'actor.email': 1, at: -1 });

export default mongoose.model('AuditLog', auditSchema);
