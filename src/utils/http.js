const { createHash } = require("node:crypto");
const { fail } = require("../middleware/errors");
function entityTag(value) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return `"${digest}"`;
}
function lastModification(value) {
  let latest = 0;
  function visit(item) {
    if (!item || typeof item !== "object") return;
    for (const field of ["createdAt", "updatedAt"]) {
      if (item[field]) {
        const time = new Date(item[field]).getTime();
        if (Number.isFinite(time)) latest = Math.max(latest, time);
      }
    }
    for (const child of Object.values(item)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object" && !(child instanceof Date)) visit(child);
    }
  }
  visit(value);
  return latest ? new Date(latest) : null;
}
function tagMatches(header, tag, weakAllowed) {
  if (!header) return false;
  const tags = header.split(",").map((value) => value.trim());
  if (tags.includes("*")) return true;
  const normalize = (value) => weakAllowed ? value.replace(/^W\//, "") : value;
  return tags.some((value) => normalize(value) === normalize(tag));
}
function sendRepresentation(req, res, data, status = 200) {
  const body = { data };
  const tag = entityTag(body);
  const modified = lastModification(data);
  res.set("ETag", tag);
  res.set("Cache-Control", "private, no-cache");
  res.vary("Authorization");
  if (modified) res.set("Last-Modified", modified.toUTCString());
  if (status === 200 && ["GET", "HEAD"].includes(req.method) && tagMatches(req.get("If-None-Match"), tag, true)) {
    return res.status(304).end();
  }
  return res.status(status).json(body);
}
function requireMatch(req, resource) {
  const supplied = req.get("If-Match");
  if (!supplied) fail(428, "PRECONDITION_REQUIRED", "Retrieve this resource and supply its ETag in If-Match");
  if (!tagMatches(supplied, entityTag({ data: resource }), false)) {
    fail(412, "PRECONDITION_FAILED", "The resource has changed; retrieve its latest version");
  }
}
async function paginate(req, model, filter, sort, options) {
  const { page, limit } = options;
  const skip = (page - 1) * limit;
  const [data, count] = await Promise.all([
    model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    model.countDocuments(filter)
  ]);
  const pages = Math.ceil(count / limit);
  const link = (target) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) params.set(key, String(value));
    params.set("page", String(target));
    params.set("limit", String(limit));
    return `${req.baseUrl}${req.path}?${params.toString()}`;
  };
  return {
    data,
    pagination: {
      page, limit, count, pages,
      next: page < pages ? link(page + 1) : null,
      previous: page > 1 && pages > 0 ? link(page - 1) : null
    }
  };
}
function sendPage(req, res, page) {
  const tag = entityTag(page);
  res.set("ETag", tag);
  res.set("Cache-Control", "private, no-cache");
  res.vary("Authorization");
  // ETag is authoritative for collection membership, including deletion.
  if (tagMatches(req.get("If-None-Match"), tag, true)) return res.status(304).end();
  return res.json(page);
}
module.exports = { entityTag, sendRepresentation, requireMatch, paginate, sendPage };
