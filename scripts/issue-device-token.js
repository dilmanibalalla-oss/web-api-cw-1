const mongoose = require("mongoose");
const { connectDatabase } = require("../src/database");
const { Installation } = require("../src/models");
const { signToken } = require("../src/middleware/auth");
const { validateId } = require("../src/validators");
async function issue() {
  const id = validateId(process.argv[2]);
  await connectDatabase();
  const installation = await Installation.findById(id).lean();
  if (!installation) throw new Error("Installation not found");
  const token = signToken({ sub: String(installation._id), kind: "device", scope: "installation-write" });
  console.log(token);
}
issue().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect(); });
