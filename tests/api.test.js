const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../src/app");
const { connectDatabase } = require("../src/database");
const models = require("../src/models");
const { signToken, hashPassword } = require("../src/middleware/auth");
const { Province, District, Substation, Installation, Reading, User } = models;
const base = "/solar/v1";
let nationalToken, districtToken, adminToken, deviceToken;
let installationA, installationB, districtA;
const authorization = (token) => `Bearer ${token}`;
before(async () => {
  await connectDatabase();
  if (!mongoose.connection.name.endsWith("_test")) {
    throw new Error("Tests require a database name ending in _test");
  }
  for (const model of Object.values(models)) {
    await model.deleteMany({});
    await model.createIndexes();
  }
  const province = await Province.create({ name: "Test Province", code: "TP" });
  districtA = await District.create({ name: "District A", province: province._id });
  const districtB = await District.create({ name: "District B", province: province._id });
  const substationA = await Substation.create({ name: "Substation A", code: "SA", district: districtA._id });
  const substationB = await Substation.create({ name: "Substation B", code: "SB", district: districtB._id });
  const installationBody = { capacityKw: 5, latitude: 6.9, longitude: 79.8 };
  installationA = await Installation.create({
    ...installationBody, name: "Installation A", meterId: "TEST-METER-A", substation: substationA._id
  });
  installationB = await Installation.create({
    ...installationBody, name: "Installation B", meterId: "TEST-METER-B", substation: substationB._id
  });
  const passwordHash = await hashPassword("Test-password-long-123!");
  const [national, districtUser, admin] = await User.create([
    { email: "national@test.example", passwordHash, role: "national" },
    { email: "district@test.example", passwordHash, role: "district", district: districtA._id },
    { email: "admin@test.example", passwordHash, role: "admin" }
  ]);
  nationalToken = signToken({ sub: String(national._id), kind: "user", scope: "analyst-read" });
  districtToken = signToken({ sub: String(districtUser._id), kind: "user", scope: "analyst-read" });
  adminToken = signToken({ sub: String(admin._id), kind: "user", scope: "analyst-read metadata-write" });
  deviceToken = signToken({ sub: String(installationA._id), kind: "device", scope: "installation-write" });
  const start = Date.now() - 60 * 60 * 1000;
  await Reading.insertMany(Array.from({ length: 6 }, (_, index) => ({
    installation: installationA._id, timestamp: new Date(start + index * 5 * 60 * 1000),
    powerKw: 1, cumulativeEnergyKwh: 100 + index, voltage: 230
  })));
  await Reading.create({ installation: installationB._id, timestamp: new Date(start),
    powerKw: 2, cumulativeEnergyKwh: 50, voltage: 230 });
});
after(async () => { await mongoose.disconnect(); });
test("protected collections reject missing authentication", async () => {
  const response = await request(app).get(`${base}/installations`);
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHENTICATED");
});
test("pagination returns count and traversable links", async () => {
  const first = await request(app).get(`${base}/installations/${installationA._id}/readings?limit=2`)
    .set("Authorization", authorization(nationalToken));
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 2);
  assert.equal(first.body.pagination.count, 6);
  assert.equal(first.body.pagination.previous, null);
  const second = await request(app).get(first.body.pagination.next).set("Authorization", authorization(nationalToken));
  assert.equal(second.status, 200);
  assert.equal(second.body.pagination.page, 2);
  assert.ok(second.body.pagination.previous);
});
test("timestamp sorting and time windows are enforced", async () => {
  const ascending = await request(app).get(`${base}/installations/${installationA._id}/readings?sort=timestamp`)
    .set("Authorization", authorization(nationalToken));
  const timestamps = ascending.body.data.map((reading) => reading.timestamp);
  assert.deepEqual(timestamps, [...timestamps].sort());
  const from = timestamps[1], to = timestamps[3];
  const filtered = await request(app).get(`${base}/installations/${installationA._id}/readings`)
    .query({ from, to, sort: "timestamp" }).set("Authorization", authorization(nationalToken));
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.count, 2);
});
test("conditional GET returns 304 without a body", async () => {
  const uri = `${base}/installations/${installationA._id}`;
  const first = await request(app).get(uri).set("Authorization", authorization(nationalToken));
  assert.ok(first.headers.etag);
  assert.ok(first.headers["last-modified"]);
  const cached = await request(app).get(uri).set("Authorization", authorization(nationalToken))
    .set("If-None-Match", first.headers.etag);
  assert.equal(cached.status, 304);
  assert.equal(cached.text, "");
});
test("district users cannot retrieve another district's installation", async () => {
  const response = await request(app).get(`${base}/installations/${installationB._id}`)
    .set("Authorization", authorization(districtToken));
  assert.equal(response.status, 404);
});
test("global readings never expose another district's rows", async () => {
  const response = await request(app).get(`${base}/readings`).set("Authorization", authorization(districtToken));
  assert.equal(response.status, 200);
  assert.ok(response.body.data.every((reading) => reading.installation === String(installationA._id)));
  const filtered = await request(app).get(`${base}/readings`)
    .query({ installation: String(installationB._id) }).set("Authorization", authorization(districtToken));
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.pagination.count, 0);
});
test("analysts cannot ingest readings", async () => {
  const response = await request(app).post(`${base}/installations/${installationA._id}/readings`)
    .set("Authorization", authorization(nationalToken)).send({
      timestamp: new Date().toISOString(), powerKw: 1, cumulativeEnergyKwh: 106, voltage: 230
    });
  assert.equal(response.status, 403);
});
test("devices cannot write another installation", async () => {
  const response = await request(app).post(`${base}/installations/${installationB._id}/readings`)
    .set("Authorization", authorization(deviceToken)).send({
      timestamp: new Date().toISOString(), powerKw: 1, cumulativeEnergyKwh: 106, voltage: 230
    });
  assert.equal(response.status, 403);
});
test("ingestion creates a retrievable resource and rejects duplicates", async () => {
  const body = { timestamp: new Date().toISOString(), powerKw: 1, cumulativeEnergyKwh: 106, voltage: 230 };
  const created = await request(app).post(`${base}/installations/${installationA._id}/readings`)
    .set("Authorization", authorization(deviceToken)).send(body);
  assert.equal(created.status, 201);
  assert.ok(created.headers.location);
  const retrieved = await request(app).get(created.headers.location).set("Authorization", authorization(deviceToken));
  assert.equal(retrieved.status, 200);
  const duplicate = await request(app).post(`${base}/installations/${installationA._id}/readings`)
    .set("Authorization", authorization(deviceToken)).send(body);
  assert.equal(duplicate.status, 409);
  const altered = await request(app).patch(created.headers.location)
    .set("Authorization", authorization(deviceToken)).send({ powerKw: 2 });
  assert.equal(altered.status, 405);
});
test("metadata CRUD enforces ETag preconditions", async () => {
  const created = await request(app).post(`${base}/provinces`).set("Authorization", authorization(adminToken))
    .send({ name: "Temporary Province", code: "TEMP" });
  assert.equal(created.status, 201);
  const uri = created.headers.location;
  const missing = await request(app).patch(uri).set("Authorization", authorization(adminToken))
    .send({ name: "Updated Province" });
  assert.equal(missing.status, 428);
  const stale = await request(app).patch(uri).set("Authorization", authorization(adminToken))
    .set("If-Match", '"incorrect"').send({ name: "Updated Province" });
  assert.equal(stale.status, 412);
  const updated = await request(app).put(uri).set("Authorization", authorization(adminToken))
    .set("If-Match", created.headers.etag).send({ name: "Updated Province", code: "TEMP" });
  assert.equal(updated.status, 200);
  const deleted = await request(app).delete(uri).set("Authorization", authorization(adminToken))
    .set("If-Match", updated.headers.etag);
  assert.equal(deleted.status, 204);
});
test("resources with children cannot be deleted", async () => {
  const uri = `${base}/districts/${districtA._id}`;
  const current = await request(app).get(uri).set("Authorization", authorization(adminToken));
  const response = await request(app).delete(uri).set("Authorization", authorization(adminToken))
    .set("If-Match", current.headers.etag);
  assert.equal(response.status, 409);
});
test("invalid pagination and unsupported representations are rejected", async () => {
  const invalid = await request(app).get(`${base}/readings?limit=101`).set("Authorization", authorization(nationalToken));
  assert.equal(invalid.status, 400);
  const unacceptable = await request(app).get(`${base}/readings`).set("Authorization", authorization(nationalToken))
    .set("Accept", "application/xml");
  assert.equal(unacceptable.status, 406);
});
test("summary and composite are available", async () => {
  const summary = await request(app).get(`${base}/districts/${districtA._id}/generation-summary`)
    .set("Authorization", authorization(districtToken));
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.installationCount, 1);
  const composite = await request(app).get(`${base}/installations/${installationA._id}/composite`)
    .set("Authorization", authorization(districtToken));
  assert.equal(composite.status, 200);
  assert.ok(composite.body.data.province);
  assert.ok(composite.body.data.lastKnownReading);
});
test("login returns a usable token and docs require no login", async () => {
  const login = await request(app).post(`${base}/auth/token`)
    .send({ email: "national@test.example", password: "Test-password-long-123!" });
  assert.equal(login.status, 200);
  assert.ok(login.body.accessToken);
  const specification = await request(app).get(`${base}/openapi.json`);
  assert.equal(specification.status, 200);
  assert.equal(specification.body.openapi, "3.0.3");
});
