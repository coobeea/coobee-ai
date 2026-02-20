#!/usr/bin/env node

import { WebSocket } from 'ws';

const WS_URL = 'ws://127.0.0.1:8765/gateway/ws';

console.log(`Attempting to connect to: ${WS_URL}`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected successfully!');
  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket connection error:', error.message);
  process.exit(1);
});

ws.on('upgrade', (response) => {
  console.log('📡 HTTP Upgrade response:');
  console.log('  Status:', response.statusCode, response.statusMessage);
  console.log('  Headers:', response.headers);
});

ws.on('unexpected-response', (request, response) => {
  console.error('❌ Unexpected HTTP response:');
  console.error('  Status:', response.statusCode, response.statusMessage);
  console.error('  Headers:', response.headers);

  let body = '';
  response.on('data', (chunk) => (body += chunk));
  response.on('end', () => {
    console.error('  Body:', body);
    process.exit(1);
  });
});

setTimeout(() => {
  console.error('❌ Connection timeout');
  ws.close();
  process.exit(1);
}, 5000);
