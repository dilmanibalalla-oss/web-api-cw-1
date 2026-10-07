const express = require("express");
const mongoose = require("mongoose");
const { randomBytes } = require("node:crypto");
const config = require("../config");
const { Province, District, Substation, Installation, Reading, User } = require("../models");
const {
  authenticate, requireReader, requireAdmin, requireDevice, loginThrottle,
  verifyPassword, hashPassword, signToken
} = require("../middleware/auth");
const {
  metadataSchemas, readingSchema, loginSchema, query, validateId, noQuery
} = require("../validators");
const { sendRepresentation, requireMatch, paginate, sendPage } = require("../utils/http");
const { authorizedScope, accessibleResource } = require("../services/scope");
const { fail } = require("../middleware/errors");
const router = express.Router();
const resources = {
  provinces: { model: Province, parent: null, child: { model: District, field: "province" } },
  districts: { model: District, parent: { model: Province, field: "province" }, child: { model: Substation, field: "district" } },
  substations: { model: Substation, parent: { model: District, field: "district" }, child: { model: Installation, field: "substation" } },
  installations: { model: Installation, parent: { model: Substation, field: "substation" }, child: { model: Reading, field: "installation" } }
};
let dummyHashPromise;
router.post("/auth/token", loginThrottle, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email }).select("+passwordHash").lean();
  if (!dummyHashPromise) dummyHashPromise = hashPassword(randomBytes(32).toString("hex"));
  const stored = user ? user.passwordHash : await dummyHashPromise;
  const valid = await verifyPassword(input.password, stored);
  if (!user || !valid) fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  const scope = user.role === "admin" ? "analyst-read metadata-write" : "analyst-read";
  const accessToken = signToken({ sub: String(user._id), kind: "user", scope });
  res.set("Cache-Control", "no-store");
  res.json({ accessToken, tokenType: "Bearer", expiresIn: 3600 });
});
router.use(authenticate);
async function listMetadata(req, res, collection, forced = {}) {
  const options = query(req);
  const scope = await authorizedScope(req.auth, { ...options, ...forced });
  const result = await paginate(req, resources[collection].model,
    { _id: { $in: scope[collection].map((row) => row._id) } },
    { name: 1, _id: 1 }, options);
  sendPage(req, res, result);
}
async function assertParent(definition, body, session) {
  if (!definition.parent) return;
  const { model, field } = definition.parent;
  const parent = await model.findById(body[field]).session(session);
  if (!parent) fail(400, "INVALID_PARENT", `${field} does not exist`);
  // Coordinate child creation with deletion of its parent.
  await model.updateOne({ _id: parent._id }, { $inc: { __v: 1 } }, { session });
}
async function assertNoChildren(definition, id, session) {
  const child = await definition.child.model.exists({
    [definition.child.field]: id
  }).session(session);
  if (child) fail(409, "RESOURCE_HAS_CHILDREN", "Remove dependent resources before deleting this resource");
}
for (const [collection, definition] of Object.entries(resources)) {
  const path = `/${collection}`;
  router.get(path, requireReader, async (req, res) => {
    await listMetadata(req, res, collection);
  });
  router.get(`${path}/:id`, requireReader, async (req, res) => {
    noQuery(req);
    const id = validateId(req.params.id);
    const resource = await accessibleResource(req.auth, collection, id);
    sendRepresentation(req, res, resource);
  });
  router.post(path, requireAdmin, async (req, res) => {
    noQuery(req);
    const body = metadataSchemas[collection].parse(req.body);
    let created;
    await mongoose.connection.transaction(async (session) => {
      await assertParent(definition, body, session);
      [created] = await definition.model.create([body], { session });
    });
    res.set("Location", `${config.base}/${collection}/${created._id}`);
    sendRepresentation(req, res, created.toObject(), 201);
  });
  for (const method of ["put", "patch"]) {
    router[method](`${path}/:id`, requireAdmin, async (req, res) => {
      noQuery(req);
      const id = validateId(req.params.id);
      const schema = method === "put" ? metadataSchemas[collection] : metadataSchemas[collection].partial();
      const body = schema.parse(req.body);
      if (method === "patch" && Object.keys(body).length === 0) fail(400, "EMPTY_PATCH", "Supply at least one field");
      let updated;
      await mongoose.connection.transaction(async (session) => {
        const current = await definition.model.findById(id).session(session).lean();
        if (!current) fail(404, "NOT_FOUND", "Resource not found");
        requireMatch(req, current);
        if (definition.parent && body[definition.parent.field] !== undefined &&
            String(current[definition.parent.field]) !== body[definition.parent.field]) {
          fail(409, "PARENT_IMMUTABLE", "Changing a resource's jurisdiction requires a separate migration");
        }
        if (collection === "installations" && body.meterId !== undefined && current.meterId !== body.meterId) {
          fail(409, "METER_ID_IMMUTABLE", "Meter identity cannot be changed through metadata updates");
        }
        updated = await definition.model.findOneAndUpdate(
          { _id: id, __v: current.__v }, { $set: body, $inc: { __v: 1 } },
          { new: true, runValidators: true, session }
        ).lean();
        if (!updated) fail(412, "PRECONDITION_FAILED", "Resource changed concurrently");
      });
      sendRepresentation(req, res, updated);
    });
  }
  router.delete(`${path}/:id`, requireAdmin, async (req, res) => {
    noQuery(req);
    const id = validateId(req.params.id);
    await mongoose.connection.transaction(async (session) => {
      const current = await definition.model.findById(id).session(session).lean();
      if (!current) fail(404, "NOT_FOUND", "Resource not found");
      requireMatch(req, current);
      await assertNoChildren(definition, id, session);
      const result = await definition.model.deleteOne({ _id: id, __v: current.__v }, { session });
      if (!result.deletedCount) fail(412, "PRECONDITION_FAILED", "Resource changed concurrently");
    });
    res.status(204).end();
  });
}
router.get("/provinces/:id/districts", requireReader, async (req, res) => {
  const id = validateId(req.params.id);
  await accessibleResource(req.auth, "provinces", id);
  await listMetadata(req, res, "districts", { province: id });
});
router.get("/districts/:id/substations", requireReader, async (req, res) => {
  const id = validateId(req.params.id);
  await accessibleResource(req.auth, "districts", id);
  await listMetadata(req, res, "substations", { district: id });
});
router.get("/substations/:id/installations", requireReader, async (req, res) => {
  const id = validateId(req.params.id);
  await accessibleResource(req.auth, "substations", id);
  await listMetadata(req, res, "installations", { substation: id });
});
router.get("/installations/:id/composite", requireReader, async (req, res) => {
  noQuery(req);
  const id = validateId(req.params.id);
  const installation = await accessibleResource(req.auth, "installations", id);
  const substation = await Substation.findById(installation.substation).lean();
  const district = await District.findById(substation.district).lean();
  const province = await Province.findById(district.province).lean();
  const lastKnownReading = await Reading.findOne({ installation: id }).sort({ timestamp: -1, _id: -1 }).lean();
  sendRepresentation(req, res, { installation, substation, district, province, lastKnownReading });
});
router.get("/installations/:id/last-known-reading", requireReader, async (req, res) => {
  noQuery(req);
  const id = validateId(req.params.id);
  await accessibleResource(req.auth, "installations", id);
  const reading = await Reading.findOne({ installation: id }).sort({ timestamp: -1, _id: -1 }).lean();
  if (!reading) fail(404, "NO_READINGS", "Installation has no readings");
  sendRepresentation(req, res, reading);
});
async function readingCollection(req, res, installationId = null) {
  const options = query(req, true);
  if (installationId) {
    await accessibleResource(req.auth, "installations", installationId);
    if (options.installation && options.installation !== installationId) {
      fail(400, "CONFLICTING_FILTER", "Installation filter conflicts with URI");
    }
    options.installation = installationId;
  }
  const scope = await authorizedScope(req.auth, options);
  const filter = { installation: { $in: scope.installations.map((row) => row._id) } };
  if (options.from || options.to) {
    filter.timestamp = {};
    if (options.from) filter.timestamp.$gte = new Date(options.from);
    if (options.to) filter.timestamp.$lt = new Date(options.to);
  }
  const direction = options.sort === "timestamp" ? 1 : -1;
  const result = await paginate(req, Reading, filter, { timestamp: direction, _id: direction }, options);
  sendPage(req, res, result);
}
router.get("/readings", requireReader, async (req, res) => {
  await readingCollection(req, res);
});
router.get("/installations/:id/readings", requireReader, async (req, res) => {
  const id = validateId(req.params.id);
  await readingCollection(req, res, id);
});
router.get("/installations/:id/readings/:readingId", async (req, res) => {
  noQuery(req);
  const id = validateId(req.params.id);
  const readingId = validateId(req.params.readingId);
  if (req.auth.kind === "device") requireDevice(req, id);
  else {
    requireReader(req, res, () => {});
    await accessibleResource(req.auth, "installations", id);
  }
  const reading = await Reading.findOne({ _id: readingId, installation: id }).lean();
  if (!reading) fail(404, "NOT_FOUND", "Reading not found");
  sendRepresentation(req, res, reading);
});
router.post("/installations/:id/readings", async (req, res) => {
  noQuery(req);
  const id = validateId(req.params.id);
  requireDevice(req, id);
  const body = readingSchema.parse(req.body);
  const timestamp = new Date(body.timestamp);
  if (timestamp.getTime() > Date.now() + 5 * 60 * 1000) {
    fail(400, "FUTURE_TIMESTAMP", "Timestamp may not be more than five minutes in the future");
  }
  if (body.powerKw > req.auth.installation.capacityKw * 1.2) {
    fail(400, "IMPLAUSIBLE_POWER", "Power exceeds 120% of installation capacity");
  }
  let created;
  await mongoose.connection.transaction(async (session) => {
    const parent = await Installation.findByIdAndUpdate(id, { $inc: { __v: 1 } }, { new: true, session }).lean();
    if (!parent) fail(404, "NOT_FOUND", "Installation not found");
    // MongoDB transaction operations must run sequentially on this session.
    const previous = await Reading.findOne({
      installation: id, timestamp: { $lt: timestamp }
    }).sort({ timestamp: -1 }).session(session).lean();
    const following = await Reading.findOne({
      installation: id, timestamp: { $gt: timestamp }
    }).sort({ timestamp: 1 }).session(session).lean();
    if (previous && body.cumulativeEnergyKwh < previous.cumulativeEnergyKwh) {
      fail(409, "ENERGY_COUNTER_DECREASE", "Cumulative energy is lower than the preceding reading");
    }
    if (following && body.cumulativeEnergyKwh > following.cumulativeEnergyKwh) {
      fail(409, "ENERGY_COUNTER_INCONSISTENT", "Cumulative energy exceeds the following reading");
    }
    [created] = await Reading.create([{ ...body, timestamp, installation: id }], { session });
  });
  res.set("Location", `${config.base}/installations/${id}/readings/${created._id}`);
  sendRepresentation(req, res, created.toObject(), 201);
});
router.all("/installations/:id/readings/:readingId", (req, res) => {
  res.set("Allow", "GET, HEAD");
  fail(405, "METHOD_NOT_ALLOWED", "Historical readings are immutable");
});
router.get("/districts/:id/generation-summary", requireReader, async (req, res) => {
  noQuery(req);
  const id = validateId(req.params.id);
  const district = await accessibleResource(req.auth, "districts", id);
  const scope = await authorizedScope(req.auth, { district: id });
  const installationIds = scope.installations.map((row) => row._id);
  const now = new Date();
  const offsetMs = 330 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  async function lastPerInstallation(extra) {
    return Reading.aggregate([
      { $match: { installation: { $in: installationIds }, ...extra } },
      { $sort: { installation: 1, timestamp: -1 } },
      { $group: { _id: "$installation", reading: { $first: "$$ROOT" } } }
    ]);
  }
  const [latest, baselines, today] = await Promise.all([
    lastPerInstallation({ timestamp: { $lte: now } }),
    lastPerInstallation({ timestamp: { $lte: dayStart } }),
    lastPerInstallation({ timestamp: { $gte: dayStart, $lt: dayEnd, $lte: now } })
  ]);
  const baselineMap = new Map(baselines.map((row) => [String(row._id), row.reading]));
  let currentPowerKw = 0;
  let freshInstallationCount = 0;
  let newestTimestamp = null;
  for (const row of latest) {
    const timestamp = new Date(row.reading.timestamp);
    const age = now - timestamp;
    if (age <= 30 * 60 * 1000) {
      currentPowerKw += row.reading.powerKw;
      freshInstallationCount++;
    }
    if (!newestTimestamp || timestamp > newestTimestamp) newestTimestamp = timestamp;
  }
  let observedEnergyKwh = 0;
  let energyCoveredInstallationCount = 0;
  for (const row of today) {
    const baseline = baselineMap.get(String(row._id));
    if (baseline && dayStart - new Date(baseline.timestamp) <= 30 * 60 * 1000) {
      observedEnergyKwh += Math.max(0, row.reading.cumulativeEnergyKwh - baseline.cumulativeEnergyKwh);
      energyCoveredInstallationCount++;
    }
  }
  const referenceSlot = new Date(Math.floor(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000));
  sendRepresentation(req, res, {
    district: { _id: district._id, name: district.name },
    timezone: "Asia/Colombo", dayStart, dayEnd, referenceSlot,
    latestReadingTimestamp: newestTimestamp,
    installationCount: installationIds.length,
    reportingInstallationCount: latest.length,
    freshInstallationCount,
    staleOrMissingInstallationCount: installationIds.length - freshInstallationCount,
    currentPowerKw: Number(currentPowerKw.toFixed(3)),
    observedEnergyTodayKwh: Number(observedEnergyKwh.toFixed(3)),
    energyCoveredInstallationCount,
    energyCoverageComplete: energyCoveredInstallationCount === installationIds.length
  });
});
module.exports = router;
