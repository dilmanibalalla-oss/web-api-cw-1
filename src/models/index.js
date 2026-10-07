const mongoose = require("mongoose");
const { Schema } = mongoose;
const options = { timestamps: true, versionKey: "__v" };
const reference = (model) => ({
  type: Schema.Types.ObjectId, ref: model, required: true, index: true
});
const provinceSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true }
}, options);
const districtSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  province: reference("Province")
}, options);
districtSchema.index({ province: 1, name: 1 }, { unique: true });
const substationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, trim: true, uppercase: true, unique: true },
  district: reference("District")
}, options);
const installationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  meterId: { type: String, required: true, trim: true, unique: true },
  substation: reference("Substation"),
  capacityKw: { type: Number, required: true, min: 0.1, max: 10000 },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 }
}, options);
const readingSchema = new Schema({
  installation: reference("Installation"),
  timestamp: { type: Date, required: true, immutable: true },
  powerKw: { type: Number, required: true, min: 0, immutable: true },
  cumulativeEnergyKwh: { type: Number, required: true, min: 0, immutable: true },
  voltage: { type: Number, required: true, min: 0, max: 500, immutable: true }
}, options);
readingSchema.index({ installation: 1, timestamp: 1 }, { unique: true });
readingSchema.index({ timestamp: -1, _id: -1 });
const userSchema = new Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["admin", "national", "province", "district"], required: true },
  province: { type: Schema.Types.ObjectId, ref: "Province", default: null },
  district: { type: Schema.Types.ObjectId, ref: "District", default: null }
}, options);
// Infrastructure collection, not another business-domain entity.
const loginBucketSchema = new Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true }
}, { versionKey: false });
loginBucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = {
  Province: mongoose.model("Province", provinceSchema),
  District: mongoose.model("District", districtSchema),
  Substation: mongoose.model("Substation", substationSchema),
  Installation: mongoose.model("Installation", installationSchema),
  Reading: mongoose.model("Reading", readingSchema),
  User: mongoose.model("User", userSchema),
  LoginBucket: mongoose.model("LoginBucket", loginBucketSchema)
};
