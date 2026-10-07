const fs = require("node:fs");
const path = require("node:path");
const swagger = require("swagger-ui-dist");
const target = path.join(__dirname, "..", "public", "swagger");
fs.mkdirSync(target, { recursive: true });
for (const file of [
  "swagger-ui.css",
  "swagger-ui-bundle.js",
  "swagger-ui-standalone-preset.js"
]) {
  fs.copyFileSync(path.join(swagger.getAbsoluteFSPath(), file), path.join(target, file));
}
console.log("Swagger assets prepared");
