#!/usr/bin/env node

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const preferredInterfaces = [/^wlan/i, /^wl/i, /^eth/i, /^en/i];
const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function addresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries || [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal && privateIpv4.test(entry.address))
      .map((entry) => ({ name, address: entry.address })),
  );
}

const available = addresses();
const selected = available.find(({ name }) => preferredInterfaces.some((pattern) => pattern.test(name))) || available[0];

if (!selected) {
  console.error('No private LAN IPv4 address was found. Connect the Raspberry Pi to Wi-Fi or Ethernet, then try again.');
  process.exit(1);
}

const backendUrl = `http://${selected.address}:8001`;
console.log(`Using ${selected.name} (${backendUrl}) for the ConKiosk backend.`);

const expo = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'expo.cmd' : 'expo');
const child = spawn(expo, ['start', '--lan'], {
  cwd: process.cwd(),
  env: { ...process.env, EXPO_PUBLIC_BACKEND_URL: backendUrl },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(`Could not start Expo: ${error.message}`);
  process.exit(1);
});
