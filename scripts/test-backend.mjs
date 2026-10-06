import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const sdk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.env.NEBULA_BACKEND_DIR || join(sdk, '..', 'nebula-backend'));
await access(join(backend, 'go.mod'));
const temporary = await mkdtemp(join(tmpdir(), 'nebula-sdk-contracts-'));
let server;
let logs = '';

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const process = spawn(command, args, options);
    process.once('error', reject);
    process.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolveListen);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise((resolveClose, reject) =>
    listener.close((error) => (error ? reject(error) : resolveClose()))
  );
  return address.port;
}

async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!server.pid || server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Test backend exited before becoming ready.\n${logs}`);
    }
    try {
      const response = await fetch(`${url}/ping`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.text()) === 'pong') return;
    } catch {
      // Startup can briefly refuse connections while SQLite metadata is initialized.
    }
    await delay(100);
  }
  throw new Error(`Test backend did not become ready.\n${logs}`);
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolveExit) => server.once('exit', resolveExit));
  server.kill('SIGTERM');
  const watchdog = setTimeout(() => server.kill('SIGKILL'), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(watchdog);
  }
}

try {
  console.log('Building the local backend for isolated SDK integration tests…');
  const binary = join(temporary, 'nebula-backend');
  await run('go', ['build', '-o', binary, './cmd/server'], { cwd: backend, stdio: 'inherit' });
  for (const suite of [
    'auth',
    'contracts',
    'sql',
    'analytics',
    'diagram',
    'objects',
    'exports',
    'details',
    'alter',
  ]) {
    // Separate servers keep each suite below the real per-IP rate limit.
    const suiteDirectory = join(temporary, suite);
    await mkdir(suiteDirectory);
    logs = '';
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    server = spawn(binary, [], {
      cwd: suiteDirectory,
      env: {
        ...process.env,
        APP_ENV: 'production',
        SERVER_PORT: String(port),
        JWT_SECRET: randomBytes(32).toString('hex'),
        JWT_EXPIRATION_HOURS: '1',
        DATABASE_DIRECTORY: join(suiteDirectory, 'data'),
        DATABASE_DIRECTORY_FILE: 'metadata.db',
        ALLOWED_ORIGINS: 'http://localhost:3000',
        GIN_MODE: 'release',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => {
      logs = (logs + chunk).slice(-12000);
    });
    server.stderr.on('data', (chunk) => {
      logs = (logs + chunk).slice(-12000);
    });
    server.once('error', (error) => {
      logs += error.message;
    });
    await ready(url);
    console.log('Running SDK tests against a temporary backend and temporary SQLite data.');
    await run(
      process.execPath,
      [
        join(sdk, 'node_modules/jest/bin/jest.js'),
        '--runInBand',
        '--coverage=false',
        `test/integration/${suite}.integration.test.ts`,
      ],
      {
        cwd: sdk,
        env: { ...process.env, NEBULA_TEST_URL: url },
        stdio: 'inherit',
      }
    );
    await stopServer();
  }
} finally {
  await stopServer();
  await rm(temporary, { recursive: true, force: true });
}
