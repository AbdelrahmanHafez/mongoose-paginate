/**
 * Packs the package and verifies it from real ESM, CommonJS, and TypeScript
 * consumers. Runs against the tarball, not the source tree, so it catches
 * packaging mistakes such as stale dist files or broken export conditions.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const workDir = mkdtempSync(join(tmpdir(), 'mongoose-paginate-consumer-'));

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

try {
  console.log('Packing tarball...');
  const tarballName = execFileSync('npm', ['pack', '--pack-destination', workDir], {
    cwd: packageRoot,
    encoding: 'utf8'
  }).trim().split('\n').pop();
  const tarballPath = join(workDir, tarballName);

  const consumerDir = join(workDir, 'consumer');
  cpSync(join(packageRoot, 'consumer-tests', 'fixtures'), consumerDir, { recursive: true });
  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'mongoose-paginate-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@abdelrahmanhafez/mongoose-paginate': `file:${tarballPath}`,
      mongoose: '^9.9.3'
    },
    devDependencies: {
      '@types/node': '^22.0.0',
      typescript: '^5.9.2'
    }
  }, null, 2));

  run('npm', ['install', '--no-fund', '--no-audit'], { cwd: consumerDir });

  console.log('\n--- ESM consumer ---');
  run('node', ['esm-consumer.mjs'], { cwd: consumerDir });

  console.log('\n--- CommonJS consumer ---');
  run('node', ['cjs-consumer.cjs'], { cwd: consumerDir });

  console.log('\n--- TypeScript consumer (NodeNext / ESM) ---');
  run('./node_modules/.bin/tsc', ['-p', 'tsconfig.esm-check.json'], { cwd: consumerDir });

  console.log('\n--- TypeScript consumer (CommonJS resolution) ---');
  run('./node_modules/.bin/tsc', ['-p', 'tsconfig.cjs-check.json'], { cwd: consumerDir });

  console.log('\nAll consumer tests passed.');
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
