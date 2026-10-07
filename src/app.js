const express = require("express");
const helmet = require("helmet");
const path = require("node:path");
const config = require("./config");
const { connectDatabase } = require("./database");
const { requestId, errorHandler, fail } = require("./middleware/errors");
const routes = require("./routes");
const openapi = require("./docs/openapi");
const app = express();
app.disable("x-powered-by");
app.set("etag", false);
app.set("trust proxy", process.env.VERCEL ? 1 : false);
app.use(requestId);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"], connectSrc: ["'self'"], fontSrc: ["'self'", "data:"],
      upgradeInsecureRequests: process.env.VERCEL ? [] : null
    }
  }
}));
app.use(express.static(path.join(__dirname, "..", "public")));
app.get(`${config.base}/docs/init.js`, (req, res) => {
  res.type("application/javascript").send(`
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "${config.base}/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: false,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout"
      });
    };
  `);
});
app.get([`${config.base}/docs`, `${config.base}/docs/`], (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Solar Generation API</title>
  <link rel="stylesheet" href="/swagger/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger/swagger-ui-bundle.js"></script>
  <script src="/swagger/swagger-ui-standalone-preset.js"></script>
  <script src="${config.base}/docs/init.js"></script>
</body>
</html>`);
});
app.use(config.base, (req, res, next) => {
  if (!req.accepts("json")) fail(406, "NOT_ACCEPTABLE", "This API provides JSON representations");
  if (["POST", "PUT", "PATCH"].includes(req.method) && !req.is("application/json")) {
    fail(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json");
  }
  next();
});
app.get(`${config.base}/openapi.json`, (req, res) => res.json(openapi));
app.use(express.json({ limit: "32kb" }));
app.use(config.base, async (req, res, next) => {
  await connectDatabase();
  next();
});
app.get(`${config.base}/health`, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "ok" });
});
app.use(config.base, routes);
app.use((req, res) => fail(404, "NOT_FOUND", "Route not found"));
app.use(errorHandler);
module.exports = app;
