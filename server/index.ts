import 'dotenv/config';
import { createApp } from './app.js';
import { readListenerConfig, startListeners } from './listeners.js';

const config = readListenerConfig();
const runtime = createApp();
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000); deadline.unref();
  try { await runtime.close(); process.exitCode = 0; } catch (error) { console.error('Shutdown failed:', error); process.exitCode = 1; }
  clearTimeout(deadline);
});
await startListeners(runtime, config);
console.log(`Mola server listening on port ${config.port}`);
if (config.opsPort !== undefined) console.log(`Mola operations listening on port ${config.opsPort}`);
