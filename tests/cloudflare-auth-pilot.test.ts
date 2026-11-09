import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as login } from '../app/api/auth/login/route';
import { POST as logout } from '../app/api/auth/logout/route';
import { GET as me } from '../app/api/auth/me/route';
import { hashPassword } from '../lib/auth';
import { getDb } from '../lib/mongodb';
import { proxy } from '../proxy';

process.env.AUTH_SESSION_SECRET ||= 'cloudflare-pilot-session-secret-at-least-32-bytes';

test('Worker database access requires the Cloudflare URI binding and does not fall back to Node env', async () => {
  const contextSymbol = Symbol.for('__cloudflare-context__');
  const previousContext = Object.getOwnPropertyDescriptor(globalThis, contextSymbol);
  Object.defineProperty(globalThis, contextSymbol, {
    configurable: true,
    value: { env: { MONGODB_DB: 'conic-cloudflare-pilot' }, ctx: {} }
  });

  try {
    await assert.rejects(getDb(), /MONGODB_URI is not configured as a Cloudflare Worker secret/);
  } finally {
    if (previousContext) Object.defineProperty(globalThis, contextSymbol, previousContext);
    else Reflect.deleteProperty(globalThis, contextSymbol);
  }
});

test('login, session validation, logout, and protected paths work with an isolated fake database', async () => {
  const password = 'pilot-password-long-enough';
  const passwordHash = await hashPassword(password);
  const user = {
    _id: 'pilot-user',
    email: 'pilot@example.test',
    passwordHash,
    businessId: 'conic-pilot',
    role: 'admin' as const
  };
  const previousDatabase = Object.getOwnPropertyDescriptor(globalThis, '__conicMongoDb');

  Object.defineProperty(globalThis, '__conicMongoDb', {
    configurable: true,
    writable: true,
    value: {
      collection: () => ({
        findOne: async (filter: { email?: { $regex?: string } }) =>
          filter.email?.$regex && new RegExp(filter.email.$regex, 'i').test(user.email) ? user : null
      })
    }
  });

  try {
    const loginResponse = await login(new Request('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password })
    }));
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get('set-cookie');
    if (!cookie?.startsWith('conic_session=')) throw new Error('Login did not set a session cookie.');
    assert.match(cookie, /HttpOnly/i);

    const cookiePair = cookie.split(';', 1)[0];
    const meResponse = me(new NextRequest('https://example.test/api/auth/me', {
      headers: { cookie: cookiePair }
    }));
    assert.deepEqual(await meResponse.json(), { email: user.email, role: 'admin' });

    const allowedResponse = proxy(new NextRequest('https://example.test/api/daily', {
      headers: { cookie: cookiePair }
    }));
    assert.equal(allowedResponse.headers.get('x-middleware-next'), '1');

    const deniedResponse = proxy(new NextRequest('https://example.test/api/finance', {
      headers: { cookie: cookiePair }
    }));
    assert.equal(deniedResponse.status, 403);

    const unauthenticatedResponse = proxy(new NextRequest('https://example.test/api/finance'));
    assert.equal(unauthenticatedResponse.status, 401);

    const protectedPageResponse = proxy(new NextRequest('https://example.test/settings'));
    assert.equal(protectedPageResponse.status, 307);

    const logoutResponse = await logout();
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/i);
  } finally {
    if (previousDatabase) Object.defineProperty(globalThis, '__conicMongoDb', previousDatabase);
    else Reflect.deleteProperty(globalThis, '__conicMongoDb');
  }
});
