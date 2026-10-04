#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const defaultArgs = ['contracts/line.compact', 'contracts/managed/line'];
const compileArgs = args.length > 0 ? args : ['--skip-zk', ...defaultArgs];

if (os.platform() === 'win32') {
  const cwd = process.cwd().replace(/\\/g, '/');
  const wslCmd = `/home/shrikar/.local/bin/compact compile ${compileArgs.join(' ')}`;
  const res = spawnSync('wsl', ['bash', '-c', `cd "$(wslpath -u '${cwd}')" && ${wslCmd}`], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 0);
} else {
  const res = spawnSync('compact', ['compile', ...compileArgs], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}
