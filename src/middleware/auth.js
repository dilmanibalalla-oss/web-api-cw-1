const {
  randomBytes, scrypt: scryptCallback, timingSafeEqual, createHmac
} = require("node:crypto");
const { promisify } = require("node:util");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { User, Installation, LoginBucket } = require("../models");
const { fail } = require("./errors");
const scrypt = promisify(scryptCallback);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, encoded] = stored.split(":");
  const expected = Buffer.from(encoded, "hex");
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function signToken(claims, expiresIn = "1h") {
  return jwt.sign(claims, config.jwtSecret, {
    algorithm: "HS256", expiresIn, issuer: config.jwtIssuer, audience: config.jwtAudience
  });
}
async function authenticate(req, res, next) {
  const header = req.get("Authorization");
  if (!header || !/^Bearer \S+$/i.test(header)) {
    res.set("WWW-Authenticate", 'Bearer realm="solar-api"');
    fail(401, "UNAUTHENTICATED", "A bearer token is required");
  }
  let claims;
  try {
    claims = jwt.verify(header.substring(7), config.jwtSecret, {
      algorithms: ["HS256"], issuer: config.jwtIssuer, audience: config.jwtAudience
    });
  } catch {
    res.set("WWW-Authenticate", 'Bearer realm="solar-api", error="invalid_token"');
    fail(401, "INVALID_TOKEN", "Token is invalid or expired");
  }
  if (typeof claims !== "object" || typeof claims.sub !== "string" ||
      !/^[a-fA-F0-9]{24}$/.test(claims.sub) || typeof claims.scope !== "string") {
    fail(401, "INVALID_TOKEN", "Token claims are invalid");
  }
  const scopes = claims.scope.split(" ");
  if (claims.kind === "user") {
    const user = await User.findById(claims.sub).lean();
    if (!user) fail(401, "INVALID_TOKEN", "User no longer exists");
    req.auth = { kind: "user", user, scopes };
  } else if (claims.kind === "device") {
    const installation = await Installation.findById(claims.sub).lean();
    if (!installation) fail(401, "INVALID_TOKEN", "Installation no longer exists");
    req.auth = { kind: "device", installation, scopes };
  } else {
    fail(401, "INVALID_TOKEN", "Unknown token kind");
  }
  next();
}
function requireReader(req, res, next) {
  if (req.auth.kind !== "user" || !req.auth.scopes.includes("analyst-read")) {
    fail(403, "FORBIDDEN", "Analyst read access is required");
  }
  next();
}
function requireAdmin(req, res, next) {
  if (req.auth.kind !== "user" || req.auth.user.role !== "admin" ||
      !req.auth.scopes.includes("metadata-write")) {
    fail(403, "FORBIDDEN", "Administrator metadata access is required");
  }
  next();
}
function requireDevice(req, installationId) {
  if (req.auth.kind !== "device" || !req.auth.scopes.includes("installation-write") ||
      String(req.auth.installation._id) !== installationId) {
    fail(403, "FORBIDDEN", "A device may write only to its own installation");
  }
}
async function loginThrottle(req, res, next) {
  const windowMs = 15 * 60 * 1000;
  const window = Math.floor(Date.now() / windowMs);
  const ipDigest = createHmac("sha256", config.jwtSecret)
    .update(req.ip || "unknown").digest("hex");
  const key = `${ipDigest}:${window}`;
  const expiresAt = new Date((window + 1) * windowMs);
  let bucket;
  try {
    bucket = await LoginBucket.findOneAndUpdate(
      { _id: key }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true }
    ).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    bucket = await LoginBucket.findOneAndUpdate(
      { _id: key }, { $inc: { count: 1 } }, { new: true }
    ).lean();
  }
  if (bucket.count > 20) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))));
    fail(429, "RATE_LIMITED", "Too many login attempts; try again later");
  }
  next();
}
module.exports = {
  hashPassword, verifyPassword, signToken, authenticate, requireReader,
  requireAdmin, requireDevice, loginThrottle
};
