import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const app = createApp(config, {
  database,
  logRequest: entry => console.info(JSON.stringify(entry)),
});
const server = app.listen(config.port, config.host, (error?: Error) => {
  if (error) return;
  console.info(`Brightloop backend listening at http://${config.host}:${config.port}`);
  console.info('Prototype v1: auth, owned records, reports and payment recording; other operations return 501.');
});
server.on('error', () => {
  console.error('HTTP server could not start. Check HOST/PORT and whether the port is already in use.');
  void database.close().finally(() => { process.exitCode = 1; });
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close(() => {
    void database.close().then(() => {
      clearTimeout(deadline);
      process.exitCode = 0;
    }).catch(() => {
      console.error('Database shutdown failed.');
      clearTimeout(deadline);
      process.exitCode = 1;
    });
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
