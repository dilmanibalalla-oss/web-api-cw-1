require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
const jwtSecret = required("JWT_SECRET");
if (Buffer.byteLength(jwtSecret) < 32) {
  throw new Error("JWT_SECRET must contain at least 32 bytes");
}
module.exports = {
  base: "/solar/v1",
  port: Number(process.env.PORT || 3000),
  mongoUri: required("MONGODB_URI"),
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER || "solar-api",
  jwtAudience: process.env.JWT_AUDIENCE || "solar-clients"
};
