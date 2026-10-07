const base = "/solar/v1";
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const objectId = { type: "string", pattern: "^[a-fA-F0-9]{24}$", example: "507f1f77bcf86cd799439011" };
const date = { type: "string", format: "date-time" };
const inputFields = {
  Province: {
    name: { type: "string", minLength: 2, maxLength: 100 },
    code: { type: "string", minLength: 2, maxLength: 30 }
  },
  District: { name: { type: "string", minLength: 2, maxLength: 100 }, province: objectId },
  Substation: {
    name: { type: "string", minLength: 2, maxLength: 100 },
    code: { type: "string", minLength: 2, maxLength: 30 }, district: objectId
  },
  Installation: {
    name: { type: "string", minLength: 2, maxLength: 100 },
    meterId: { type: "string", minLength: 3, maxLength: 100 },
    substation: objectId,
    capacityKw: { type: "number", minimum: 0.1, maximum: 10000 },
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 }
  },
  Reading: {
    timestamp: date, powerKw: { type: "number", minimum: 0, maximum: 100000 },
    cumulativeEnergyKwh: { type: "number", minimum: 0 },
    voltage: { type: "number", minimum: 0, maximum: 500 }
  }
};
const schemas = {
  Error: {
    type: "object", required: ["error"], properties: {
      error: {
        type: "object", required: ["code", "message", "details", "requestId"],
        properties: { code: { type: "string" }, message: { type: "string" },
          details: { nullable: true }, requestId: { type: "string", format: "uuid" } }
      }
    }
  },
  Pagination: {
    type: "object", required: ["page", "limit", "count", "pages", "next", "previous"],
    properties: {
      page: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 100 },
      count: { type: "integer", minimum: 0 }, pages: { type: "integer", minimum: 0 },
      next: { type: "string", nullable: true }, previous: { type: "string", nullable: true }
    }
  },
  TokenRequest: {
    type: "object", additionalProperties: false, required: ["email", "password"],
    properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } }
  },
  Token: {
    type: "object", properties: {
      accessToken: { type: "string" }, tokenType: { type: "string", example: "Bearer" },
      expiresIn: { type: "integer", example: 3600 }
    }
  }
};
for (const [name, properties] of Object.entries(inputFields)) {
  schemas[`${name}Input`] = {
    type: "object", additionalProperties: false, required: Object.keys(properties), properties
  };
  if (name !== "Reading") {
    schemas[`${name}Patch`] = { type: "object", additionalProperties: false, minProperties: 1, properties };
  }
  schemas[name] = {
    type: "object", required: ["_id", ...Object.keys(properties)], properties: {
      _id: objectId, ...properties,
      ...(name === "Reading" ? { installation: objectId } : {}),
      createdAt: date, updatedAt: date, __v: { type: "integer" }
    }
  };
}
schemas.Composite = {
  type: "object", properties: {
    installation: ref("Installation"), substation: ref("Substation"),
    district: ref("District"), province: ref("Province"),
    lastKnownReading: { allOf: [ref("Reading")], nullable: true }
  }
};
schemas.Summary = {
  type: "object", properties: {
    district: { type: "object", properties: { _id: objectId, name: { type: "string" } } },
    timezone: { type: "string", example: "Asia/Colombo" },
    dayStart: date, dayEnd: date, referenceSlot: date,
    latestReadingTimestamp: { ...date, nullable: true },
    installationCount: { type: "integer" }, reportingInstallationCount: { type: "integer" },
    freshInstallationCount: { type: "integer" }, staleOrMissingInstallationCount: { type: "integer" },
    currentPowerKw: { type: "number" }, observedEnergyTodayKwh: { type: "number" },
    energyCoveredInstallationCount: { type: "integer" }, energyCoverageComplete: { type: "boolean" }
  }
};
function jsonResponse(description, schema, headers = {}) {
  return { description, headers, content: { "application/json": { schema } } };
}
const errorResponse = (description) => jsonResponse(description, ref("Error"));
const responseHeaders = {
  ETag: { description: "Representation validator", schema: { type: "string" } },
  "Last-Modified": { description: "Available for resources with modification timestamps", schema: { type: "string" } }
};
function envelope(name) {
  return { type: "object", required: ["data"], properties: { data: ref(name) } };
}
function pageSchema(name) {
  return {
    type: "object", required: ["data", "pagination"],
    properties: { data: { type: "array", items: ref(name) }, pagination: ref("Pagination") }
  };
}
const idParameter = (name = "id") => ({ name, in: "path", required: true, schema: objectId });
const conditional = {
  name: "If-None-Match", in: "header", required: false, schema: { type: "string" },
  description: "Use an ETag from a preceding GET"
};
const ifMatch = {
  name: "If-Match", in: "header", required: true, schema: { type: "string" },
  description: "Strong ETag from GET of the same atomic resource"
};
const paginationParameters = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 100000, default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  ...["province", "district", "substation"].map((name) => ({ name, in: "query", schema: objectId }))
];
const readingParameters = [
  ...paginationParameters,
  { name: "installation", in: "query", schema: objectId },
  { name: "sort", in: "query", schema: { type: "string", enum: ["timestamp", "-timestamp"], default: "-timestamp" } },
  { name: "from", in: "query", schema: date, description: "Inclusive timestamp" },
  { name: "to", in: "query", schema: date, description: "Exclusive timestamp" }
];
const commonErrors = {
  400: errorResponse("Invalid request"), 401: errorResponse("Missing or invalid bearer token"),
  403: errorResponse("Insufficient permission"), 404: errorResponse("Resource not found or inaccessible"),
  406: errorResponse("Only JSON is available"), 500: errorResponse("Internal server error"),
  503: errorResponse("Database unavailable")
};
const paths = {};
function getOperation(name, summary, parameters = [], paged = false) {
  return {
    tags: [name], summary,
    description: "Analyst access is restricted to the user's jurisdiction.",
    parameters: [...parameters, conditional], responses: {
      200: jsonResponse("Success", paged ? pageSchema(name) : envelope(name), responseHeaders),
      304: { description: "Not modified; empty response body" }, ...commonErrors
    }
  };
}
function body(name) {
  return { required: true, content: { "application/json": { schema: ref(name) } } };
}
const names = { provinces: "Province", districts: "District", substations: "Substation", installations: "Installation" };
for (const [collection, name] of Object.entries(names)) {
  paths[`/${collection}`] = {
    get: getOperation(name, `List ${collection}`, paginationParameters, true),
    post: {
      tags: [name], summary: `Create ${name.toLowerCase()}`,
      description: "Requires administrator metadata-write scope.",
      requestBody: body(`${name}Input`), responses: {
        201: jsonResponse("Created", envelope(name), { ...responseHeaders, Location: { schema: { type: "string" } } }),
        409: errorResponse("Duplicate resource"), 415: errorResponse("JSON request body required"), ...commonErrors
      }
    }
  };
  const atomic = { get: getOperation(name, `Get ${name.toLowerCase()}`, [idParameter()]) };
  for (const method of ["put", "patch"]) {
    atomic[method] = {
      tags: [name], summary: `${method === "put" ? "Replace" : "Update"} ${name.toLowerCase()}`,
      description: "Administrator only. Parent jurisdiction and meter identity are immutable. " +
        "PUT supplies all writable fields; PATCH supplies selected fields.",
      parameters: [idParameter(), ifMatch],
      requestBody: body(method === "put" ? `${name}Input` : `${name}Patch`),
      responses: {
        200: jsonResponse("Updated", envelope(name), responseHeaders),
        409: errorResponse("Duplicate or immutable field conflict"),
        412: errorResponse("ETag precondition failed"), 415: errorResponse("JSON request body required"),
        428: errorResponse("If-Match required"), ...commonErrors
      }
    };
  }
  atomic.delete = {
    tags: [name], summary: `Delete ${name.toLowerCase()}`,
    description: "Administrator only. Resources with children cannot be deleted.",
    parameters: [idParameter(), ifMatch], responses: {
      204: { description: "Deleted; empty response body" }, 409: errorResponse("Resource has children"),
      412: errorResponse("ETag precondition failed"), 428: errorResponse("If-Match required"), ...commonErrors
    }
  };
  paths[`/${collection}/{id}`] = atomic;
}
paths["/provinces/{id}/districts"] = {
  get: getOperation("District", "List districts in a province", [idParameter(), ...paginationParameters], true)
};
paths["/districts/{id}/substations"] = {
  get: getOperation("Substation", "List substations in a district", [idParameter(), ...paginationParameters], true)
};
paths["/substations/{id}/installations"] = {
  get: getOperation("Installation", "List installations at a substation", [idParameter(), ...paginationParameters], true)
};
paths["/installations/{id}/composite"] = {
  get: getOperation("Composite", "Get installation and related hierarchy", [idParameter()])
};
paths["/installations/{id}/last-known-reading"] = {
  get: getOperation("Reading", "Get most recent reading", [idParameter()])
};
paths["/readings"] = {
  get: getOperation("Reading", "Query readings across authorized installations", readingParameters, true)
};
paths["/installations/{id}/readings"] = {
  get: getOperation("Reading", "Query installation history", [idParameter(), ...readingParameters], true),
  post: {
    tags: ["Reading"], summary: "Ingest an immutable generation reading",
    description: "Requires installation-write scope on a device token whose subject " +
      "matches the installation. Duplicate timestamps return 409. " +
      "Future timestamps, implausible power, and inconsistent cumulative energy are rejected.",
    parameters: [idParameter()], requestBody: body("ReadingInput"), responses: {
      201: jsonResponse("Created", envelope("Reading"), { ...responseHeaders, Location: { schema: { type: "string" } } }),
      409: errorResponse("Duplicate or inconsistent energy counter"),
      415: errorResponse("JSON request body required"), ...commonErrors
    }
  }
};
paths["/installations/{id}/readings/{readingId}"] = {
  get: {
    ...getOperation("Reading", "Get an individual reading", [idParameter(), idParameter("readingId")]),
    description: "Jurisdiction-scoped analysts or the owning installation's device."
  }
};
paths["/districts/{id}/generation-summary"] = {
  get: getOperation("Summary", "Get district operational generation summary", [idParameter()])
};
paths["/auth/token"] = {
  post: {
    tags: ["Authentication"], summary: "Obtain an analyst or administrator access token", security: [],
    requestBody: body("TokenRequest"), responses: {
      200: jsonResponse("Token issued", ref("Token")), 400: errorResponse("Invalid request"),
      401: errorResponse("Invalid credentials"), 415: errorResponse("JSON request body required"),
      429: errorResponse("Login rate limit exceeded"), 503: errorResponse("Database unavailable")
    }
  }
};
paths["/health"] = {
  get: {
    tags: ["Operation"], summary: "Check database readiness", security: [], responses: {
      200: jsonResponse("Ready", { type: "object", properties: { status: { type: "string", example: "ok" } } }),
      503: errorResponse("Database unavailable")
    }
  }
};
module.exports = {
  openapi: "3.0.3", info: {
    title: "Solar Generation API", version: "1.0.0",
    description: "SLSEA solar generation API. Immutable device readings, " +
      "jurisdiction-scoped analyst reads, and administrator metadata CRUD."
  },
  servers: [{ url: base, description: "Current environment" }],
  security: [{ bearerAuth: [] }], paths,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http", scheme: "bearer", bearerFormat: "JWT",
        description: "analyst-read, metadata-write, or installation-write permission scopes"
      }
    }, schemas
  }
};
