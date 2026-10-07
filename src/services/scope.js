const { Province, District, Substation, Installation } = require("../models");
const { fail } = require("../middleware/errors");
const textId = (value) => String(value);
function selectWithin(rows, field, requested) {
  if (!requested) return rows;
  return rows.filter((row) => textId(row[field]) === requested);
}
async function authorizedScope(auth, filters = {}) {
  const user = auth.user;
  let provinceFilter = {};
  let districtFilter = {};
  if (user.role === "province") {
    if (!user.province) fail(403, "INVALID_SCOPE", "User has no province assignment");
    provinceFilter = { _id: user.province };
  } else if (user.role === "district") {
    if (!user.district) fail(403, "INVALID_SCOPE", "User has no district assignment");
    const assignedDistrict = await District.findById(user.district).lean();
    if (!assignedDistrict) fail(403, "INVALID_SCOPE", "Assigned district does not exist");
    provinceFilter = { _id: assignedDistrict.province };
    districtFilter = { _id: assignedDistrict._id };
  } else if (!["national", "admin"].includes(user.role)) {
    fail(403, "INVALID_SCOPE", "Unsupported user role");
  }
  let provinces = await Province.find(provinceFilter).lean();
  provinces = selectWithin(provinces, "_id", filters.province);
  let districts = await District.find({
    ...districtFilter, province: { $in: provinces.map((row) => row._id) }
  }).lean();
  districts = selectWithin(districts, "_id", filters.district);
  let substations = await Substation.find({
    district: { $in: districts.map((row) => row._id) }
  }).lean();
  substations = selectWithin(substations, "_id", filters.substation);
  let installations = await Installation.find({
    substation: { $in: substations.map((row) => row._id) }
  }).lean();
  installations = selectWithin(installations, "_id", filters.installation);
  return { provinces, districts, substations, installations };
}
async function accessibleResource(auth, collection, resourceId) {
  const scope = await authorizedScope(auth);
  const resource = scope[collection].find((row) => textId(row._id) === resourceId);
  // Nonexistent and inaccessible resources have the same response.
  if (!resource) fail(404, "NOT_FOUND", "Resource not found");
  return resource;
}
module.exports = { authorizedScope, accessibleResource };
