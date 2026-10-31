import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
export default createApp(config, { database: createDatabase(config.databaseUrl) });
