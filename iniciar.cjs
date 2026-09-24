'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { createApp } = require('./server.cjs');
const port = 4326;
const server = createApp({ dataDir: path.join(__dirname, 'data') });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `No se inició: el puerto ${port} ya está ocupado.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`RutaViva está disponible en ${url}\nPulsa Ctrl+C para detener solo este proceso.`);
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const opener = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }); opener.unref();
});
function close() { server.close(() => process.exit(0)); }
process.on('SIGINT', close); process.on('SIGTERM', close);
