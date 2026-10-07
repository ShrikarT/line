#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const defaultArgs = ['contracts/line.compact', 'contracts/managed/line'];
const compileArgs = args.length > 0 ? args : ['--skip-zk', ...defaultArgs];

const compactBin = process.env.COMPACT_BIN;
const wslDistro = process.env.WSL_DISTRO || 'Ubuntu';

if (os.platform() === 'win32') {
  const cwd = process.cwd().replace(/\\/g, '/');
  const binCmd = compactBin
    ? `${compactBin} compile ${compileArgs.join(' ')}`
    : `(which compact >/dev/null 2>&1 && compact compile ${compileArgs.join(' ')} || /home/shrikar/.local/bin/compact compile ${compileArgs.join(' ')})`;
  const wslCmd = `set -e -o pipefail; cd "$(wslpath -u '${cwd}')" && ${binCmd}`;
  const res = spawnSync('wsl', ['-d', wslDistro, 'bash', '-c', wslCmd], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 0);
} else {
  const bin = compactBin || 'compact';
  const res = spawnSync(bin, ['compile', ...compileArgs], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

