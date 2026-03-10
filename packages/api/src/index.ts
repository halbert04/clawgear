import { createConnection } from '@clawgear/db';
import { InProcessEventBus } from '@clawgear/kernel';
import { createApp, websocket } from './app.js';

const port = Number(process.env.CLAWGEAR_PORT ?? 3000);
const host = process.env.CLAWGEAR_HOST ?? '0.0.0.0';

const { db } = createConnection();
const eventBus = new InProcessEventBus();

const app = createApp({ db, eventBus });

console.log(
  JSON.stringify({
    level: 'INFO',
    message: `ClawGear API starting on ${host}:${port}`,
    timestamp: new Date().toISOString(),
  }),
);

export default {
  port,
  hostname: host,
  fetch: app.fetch,
  websocket,
};

export { createApp } from './app.js';
