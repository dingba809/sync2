import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { openDb } from './db.js';
import { loadConfig, getMasterKey } from './config.js';
import { registerRoutes } from './routes.js';
import { createScheduler } from './scheduler.js';

const cfg = loadConfig();
const db = openDb(join(cfg.dataDir, 'sync2.db'));
const masterKey = getMasterKey(cfg.dataDir);
const scheduler = createScheduler();

const app = Fastify({ logger: true });
registerRoutes(app, db, cfg, masterKey, scheduler);

app.register(fastifyStatic, { root: join(process.cwd(), 'dist') });
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
  return reply.sendFile('index.html');
});

const port = cfg.port;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  console.log(`sync2 listening on http://localhost:${port}`);
});
