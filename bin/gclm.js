#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const denoScript = path.join(__dirname, '..', 'packages', 'gclm', 'main.ts');

const denoArgs = [
  'run',
  '--allow-net',
  '--allow-env',
  '--allow-read',
  '--allow-run',
  denoScript,
  ...process.argv.slice(2)
];

const deno = spawn('deno', denoArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

deno.on('exit', (code) => {
  process.exit(code || 0);
});

deno.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('Error: Deno is not installed or not in PATH.');
    console.error('Please install Deno from https://deno.land/');
    process.exit(1);
  } else {
    console.error('Failed to run gclm:', err);
    process.exit(1);
  }
});