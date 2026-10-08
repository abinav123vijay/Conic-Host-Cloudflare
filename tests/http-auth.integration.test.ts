import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('Next HTTP pipeline applies authentication and owner-role proxy checks before route handlers', { timeout: 90000 }, async () => {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const distDir = `.next-http-tests-${process.pid}-${port}`;
  const distPath = path.resolve(distDir);
  if (fs.existsSync(distPath)) throw new Error(`Temporary Next.js output directory already exists: ${distDir}`);
  const generatedConfigFiles = ['next-env.d.ts', 'tsconfig.json'].map(file => {
    const filePath = path.resolve(file);
    return { filePath, content: fs.readFileSync(filePath, 'utf8') };
  });
  const secret = process.env.AUTH_SESSION_SECRET || 'conic-unit-test-session-secret-32-bytes-minimum';
  const logs: string[] = [];
  const server = spawn(process.execPath, [
    path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port)
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MONGODB_URI: 'mongodb://127.0.0.1:27017/conic-http-tests',
      AUTH_SESSION_SECRET: secret,
      CONIC_TEST_DIST_DIR: distDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.setEncoding('utf8').on('data', chunk => logs.push(String(chunk)));
  server.stderr.setEncoding('utf8').on('data', chunk => logs.push(String(chunk)));

  const stopServer = async () => {
    if (server.exitCode !== null || server.killed) return;
    server.kill();
    await Promise.race([
      once(server, 'exit'),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  };

  try {
    let ready = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(`${origin}/api/finance?period=invalid`);
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.equal(ready, true, `Next dev server did not become ready. ${String(lastError)} ${logs.join('').slice(-3000)}`);

    const unauthenticated = await fetch(`${origin}/api/finance?period=invalid`);
    assert.equal(unauthenticated.status, 401);

    const adminToken = createSessionToken({
      id: 'integration-admin',
      email: 'admin@example.test',
      businessId: 'test-business',
      role: 'admin'
    });
    const ownerToken = createSessionToken({
      id: 'integration-owner',
      email: 'owner@example.test',
      businessId: 'test-business',
      role: 'owner'
    });

    const forbidden = await fetch(`${origin}/api/finance?period=invalid`, {
      headers: { Cookie: `${SESSION_COOKIE}=${adminToken}` }
    });
    assert.equal(forbidden.status, 403);
    assert.match(((await forbidden.json()) as { error: string }).error, /owners only/i);

    const ownerResponse = await fetch(`${origin}/api/finance?period=invalid`, {
      headers: { Cookie: `${SESSION_COOKIE}=${ownerToken}` }
    });
    assert.equal(ownerResponse.status, 400);
    assert.match(((await ownerResponse.json()) as { error: string }).error, /valid month/i);
  } finally {
    await stopServer();
    fs.rmSync(distPath, { recursive: true, force: true });
    for (const { filePath, content } of generatedConfigFiles) {
      const current = fs.readFileSync(filePath, 'utf8');
      if (current.includes(distDir)) fs.writeFileSync(filePath, content);
    }
  }
});
