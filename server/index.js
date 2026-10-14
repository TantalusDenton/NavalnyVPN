import { loadConfig } from "./config.js";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
const config = loadConfig();
const db = createStore(config);
// Local authentication must never be exposed to the internet.
const host =
  config.authMode === "local" ? "127.0.0.1" : process.env.HOST || "0.0.0.0";
const server = createApp(config, db).listen(
  Number(process.env.PORT || 3001),
  host,
  () =>
    console.log(
      `NavalnyVPN API: http://${host}:${process.env.PORT || 3001} (${config.authMode}; ${config.provisioner})`,
    ),
);
const cleanup = setInterval(() => db.deleteExpiredSessions(Date.now()), 3600_000).unref();
process.on("SIGTERM", () => {
  clearInterval(cleanup);
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
