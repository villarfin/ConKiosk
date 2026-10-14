#!/usr/bin/env node

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// The deployed Pi reaches the dedicated router through Ethernet. Prefer that
// interface when an old Wi-Fi connection is also active, so Expo advertises the
// same LAN address that faculty phones can reach.
const preferredInterfaces = [/^eth/i, /^en/i, /^wlan/i, /^wl/i];
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

// Production exposes the API through Nginx on port 80, while Uvicorn remains
// loopback-only. Set CONKIOSK_API_PORT=8001 only for a separate direct-API
// development server that is intentionally bound to the LAN.
const apiPort = process.env.CONKIOSK_API_PORT?.trim();
const apiUrl = selected ? `http://${selected.address}${apiPort ? `:${apiPort}` : ''}/api` : process.env.EXPO_PUBLIC_API_URL;
if (selected) {
  console.log(`Using ${selected.name} (${apiUrl}) for the ConKiosk development API.`);
} else {
  console.warn('No LAN IPv4 address is available. Starting Expo locally; restart this command after the Netless router assigns the Pi its LAN address.');
}

const expo = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'expo.cmd' : 'expo');
const child = spawn(expo, ['start', selected ? '--lan' : '--localhost'], {
  cwd: process.cwd(),
  // Use the central configuration key. This intentionally overrides any stale
  // .env value when a developer changes Wi-Fi networks.
  env: { ...process.env, ...(apiUrl ? { EXPO_PUBLIC_API_URL: apiUrl } : {}) },
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(`Could not start Expo: ${error.message}`);
  process.exit(1);
});
