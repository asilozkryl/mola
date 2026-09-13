'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    MOLA_SERVER_URL: process.env.MOLA_SERVER_URL || 'http://localhost:5173',
  },
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(`Mola masaüstü başlatılamadı: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
