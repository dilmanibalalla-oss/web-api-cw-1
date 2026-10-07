const mongoose = require("mongoose");
const config = require("../config");

mongoose.set("strictQuery", true);
// Request filters are strictly validated; operators below are application-owned.
mongoose.set("sanitizeFilter", false);
let connectionPromise;
async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongoUri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
      autoIndex: false
    }).catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  }
  await connectionPromise;
  return mongoose.connection;
}
module.exports = { connectDatabase };
