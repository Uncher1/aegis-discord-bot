import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ps1 = join(here, 'kill-bot.ps1');

const r = spawnSync(
  'powershell',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);

if (r.stdout?.trim()) process.stdout.write(r.stdout);
if (r.stderr?.trim()) process.stderr.write(r.stderr);
