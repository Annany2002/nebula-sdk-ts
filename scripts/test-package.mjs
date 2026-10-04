import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'nebula-sdk-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmEnvironment = { ...process.env, npm_config_cache: join(temporary, 'npm-cache') };

try {
  const [packed] = JSON.parse(
    execFileSync(npm, ['pack', '--json', '--pack-destination', temporary], {
      cwd: sdk,
      encoding: 'utf8',
      env: npmEnvironment,
    })
  );
  const files = packed.files.map(({ path }) => path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) {
    assert(files.includes(expected), `Package is missing ${expected}`);
  }
  assert(
    files.every(
      (path) => path.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(path)
    ),
    'Package contains unexpected files outside the public distribution'
  );

  execFileSync(
    npm,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(temporary, packed.filename),
    ],
    { cwd: temporary, env: npmEnvironment, stdio: 'inherit' }
  );

  await writeFile(
    join(temporary, 'consumer.cjs'),
    `const assert = require('node:assert/strict');
const { NebulaClient, ConflictError, ApiError } = require('nebula-sdk-ts');
const client = new NebulaClient({ baseURL: 'http://localhost:8080' });
assert.equal(typeof client.auth.login, 'function');
assert.equal(typeof client.records.list, 'function');
assert(new ConflictError('duplicate') instanceof ApiError);
`
  );
  execFileSync(process.execPath, ['consumer.cjs'], { cwd: temporary, stdio: 'inherit' });

  await writeFile(
    join(temporary, 'consumer.ts'),
    `import { NebulaClient, NebulaClientConfig, ConflictError, ApiError } from 'nebula-sdk-ts';
const config: NebulaClientConfig = { baseURL: 'http://localhost:8080' };
const client: NebulaClient = new NebulaClient(config);
const error: ApiError = new ConflictError('duplicate');
void client;
void error;
`
  );
  execFileSync(
    process.execPath,
    [
      join(sdk, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2017',
      '--module',
      'CommonJS',
      '--moduleResolution',
      'node',
      '--lib',
      'ESNext,DOM',
      'consumer.ts',
    ],
    { cwd: temporary, stdio: 'inherit' }
  );
  console.log('Packed SDK passed file, CommonJS import, and TypeScript consumer checks.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
