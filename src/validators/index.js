const { z } = require("zod");
const { fail } = require("../middleware/errors");
const id = z.string().regex(/^[a-fA-F0-9]{24}$/, "Must be a valid MongoDB ObjectId");
const name = z.string().trim().min(2).max(100);
const code = z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9-]+$/)
  .transform((value) => value.toUpperCase());
const metadataSchemas = {
  provinces: z.object({ name, code }).strict(),
  districts: z.object({ name, province: id }).strict(),
  substations: z.object({ name, code, district: id }).strict(),
  installations: z.object({
    name,
    meterId: z.string().trim().min(3).max(100),
    substation: id,
    capacityKw: z.number().finite().min(0.1).max(10000),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180)
  }).strict()
};
const readingSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
  powerKw: z.number().finite().min(0).max(100000),
  cumulativeEnergyKwh: z.number().finite().min(0),
  voltage: z.number().finite().min(0).max(500)
}).strict();
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200)
}).strict();
const integer = (fallback, maximum) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).refine((value) => value <= maximum, { message: `Must be at most ${maximum}` })
  .default(String(fallback));
const querySchema = z.object({
  page: integer(1, 100000), limit: integer(25, 100),
  sort: z.enum(["timestamp", "-timestamp"]).default("-timestamp"),
  province: id.optional(), district: id.optional(), substation: id.optional(), installation: id.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict();
function query(req, readings = false) {
  const value = querySchema.parse(req.query);
  if (!readings) {
    for (const key of ["sort", "from", "to", "installation"]) {
      if (req.query[key] !== undefined) {
        fail(400, "UNSUPPORTED_FILTER", `${key} is only supported on reading collections`);
      }
    }
  }
  if (value.from && value.to && new Date(value.from) >= new Date(value.to)) {
    fail(400, "INVALID_TIME_WINDOW", "from must be earlier than to");
  }
  return value;
}
function validateId(value) { return id.parse(value); }
function noQuery(req) {
  if (Object.keys(req.query).length) {
    fail(400, "UNSUPPORTED_FILTER", "This resource accepts no query parameters");
  }
}
module.exports = { metadataSchemas, readingSchema, loginSchema, query, validateId, noQuery };
