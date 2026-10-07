require("dotenv").config();
const mongoose = require("mongoose");
const { connectDatabase } = require("../src/database");
const models = require("../src/models");
const { hashPassword } = require("../src/middleware/auth");
const { Province, District, Substation, Installation, Reading, User, LoginBucket } = models;
const geography = [
  ["Western", "WP", ["Colombo", "Gampaha", "Kalutara"]],
  ["Central", "CP", ["Kandy", "Matale", "Nuwara Eliya"]],
  ["Southern", "SP", ["Galle", "Matara", "Hambantota"]],
  ["Northern", "NP", ["Jaffna", "Kilinochchi", "Mannar", "Vavuniya", "Mullaitivu"]],
  ["Eastern", "EP", ["Batticaloa", "Ampara", "Trincomalee"]],
  ["North Western", "NWP", ["Kurunegala", "Puttalam"]],
  ["North Central", "NCP", ["Anuradhapura", "Polonnaruwa"]],
  ["Uva", "UP", ["Badulla", "Monaragala"]],
  ["Sabaragamuwa", "SGP", ["Ratnapura", "Kegalle"]]
];
async function seed() {
  await connectDatabase();
  const database = mongoose.connection.name;
  if (process.env.SEED_CONFIRM !== database) {
    throw new Error(`Seed replaces this application's data. Set SEED_CONFIRM=${database} explicitly.`);
  }
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const analystPassword = process.env.SEED_ANALYST_PASSWORD;
  if (!adminPassword || !analystPassword || adminPassword.length < 16 || analystPassword.length < 16) {
    throw new Error("Seed passwords must contain at least 16 characters");
  }
  for (const model of [Reading, Installation, Substation, District, Province, User, LoginBucket]) {
    await model.deleteMany({});
  }
  for (const model of Object.values(models)) await model.createIndexes();
  const installations = [];
  const provinces = [];
  const districts = [];
  let districtNumber = 0;
  for (const [provinceName, provinceCode, districtNames] of geography) {
    const province = await Province.create({ name: provinceName, code: provinceCode });
    provinces.push(province);
    for (const districtName of districtNames) {
      districtNumber++;
      const district = await District.create({ name: districtName, province: province._id });
      districts.push(district);
      const substation = await Substation.create({
        name: `${districtName} Grid Substation`,
        code: `GS-${String(districtNumber).padStart(2, "0")}`,
        district: district._id
      });
      for (let site = 1; site <= 9; site++) {
        const installation = await Installation.create({
          name: `${districtName} Solar Site ${site}`,
          meterId: `MTR-${districtNumber}-${String(site).padStart(3, "0")}`,
          substation: substation._id, capacityKw: 3 + site * 0.5,
          latitude: 6.0 + districtNumber * 0.12,
          longitude: 79.7 + (districtNumber % 10) * 0.12
        });
        installations.push(installation);
      }
    }
  }
  const adminHash = await hashPassword(adminPassword);
  const analystHash = await hashPassword(analystPassword);
  const western = provinces.find((row) => row.code === "WP");
  const colombo = districts.find((row) => row.name === "Colombo");
  await User.create([
    { email: "admin@slsea.example", passwordHash: adminHash, role: "admin" },
    { email: "national@slsea.example", passwordHash: analystHash, role: "national" },
    { email: "western@slsea.example", passwordHash: analystHash, role: "province", province: western._id },
    { email: "colombo@slsea.example", passwordHash: analystHash, role: "district", district: colombo._id }
  ]);
  const intervalMs = 15 * 60 * 1000;
  const points = 7 * 24 * 4;
  const end = Math.floor(Date.now() / intervalMs) * intervalMs;
  const start = end - (points - 1) * intervalMs;
  let total = 0;
  for (const [siteIndex, installation] of installations.entries()) {
    let cumulativeEnergy = 1000 + siteIndex * 20;
    const records = [];
    for (let point = 0; point < points; point++) {
      const timestamp = new Date(start + point * intervalMs);
      const local = new Date(timestamp.getTime() + 330 * 60 * 1000);
      const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
      const daylight = hour >= 6 && hour <= 18 ? Math.sin(Math.PI * (hour - 6) / 12) : 0;
      const variation = 0.75 + ((siteIndex * 13 + point * 7) % 20) / 100;
      const powerKw = Number((installation.capacityKw * daylight * variation).toFixed(3));
      cumulativeEnergy += powerKw * 0.25;
      records.push({
        installation: installation._id, timestamp, powerKw,
        cumulativeEnergyKwh: Number(cumulativeEnergy.toFixed(4)),
        voltage: 228 + ((siteIndex + point) % 9), createdAt: timestamp, updatedAt: timestamp
      });
    }
    await Reading.insertMany(records);
    total += records.length;
    if ((siteIndex + 1) % 25 === 0) console.log(`Seeded ${siteIndex + 1} installations`);
  }
  console.log({
    provinces: provinces.length, districts: districts.length,
    substations: await Substation.countDocuments(), installations: installations.length,
    readings: total, historyStart: new Date(start).toISOString(), historyEnd: new Date(end).toISOString()
  });
  console.log("Seed accounts:");
  console.log("admin@slsea.example");
  console.log("national@slsea.example");
  console.log("western@slsea.example");
  console.log("colombo@slsea.example");
  console.log("Passwords come from your local seed environment variables.");
}
seed().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect(); });
