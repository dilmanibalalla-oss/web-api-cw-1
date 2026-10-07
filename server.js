const app = require("./src/app");
const config = require("./src/config");
const { connectDatabase } = require("./src/database");
async function start() {
  await connectDatabase();
  app.listen(config.port, () => {
    console.log(`Solar API: http://localhost:${config.port}${config.base}`);
    console.log(`Swagger: http://localhost:${config.port}${config.base}/docs`);
  });
}
start().catch((error) => {
  console.error("Startup failed:", error.message);
  process.exitCode = 1;
});
