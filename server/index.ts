import 'dotenv/config';
import { createApp } from './app.js';
const { httpServer, io, db } = await createApp();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4000);
httpServer.listen(port, host, () =>
  console.log(`Grace API · http://${host}:${port} · ${db.driver}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  io.close();
  httpServer.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
