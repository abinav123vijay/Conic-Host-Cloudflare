import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createSessionToken, SESSION_COOKIE } from '../lib/auth';

const ownerToken = createSessionToken({
  id: 'owner-1',
  email: 'owner@example.test',
  businessId: 'test-business',
  role: 'owner'
});

const adminToken = createSessionToken({
  id: 'admin-1',
  email: 'admin@example.test',
  businessId: 'test-business',
  role: 'admin'
});

const staffToken = createSessionToken({
  id: 'staff-1',
  email: 'staff@example.test',
  businessId: 'test-business',
  role: 'staff'
});

function request(path: string, token?: string, method = 'GET') {
  const headers = token ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

test('owner-only APIs accept owners and reject unauthenticated and non-owner sessions', () => {
  const ownerOnlyRequests = [
    ['/api/finance?period=2026-10', 'GET'],
    ['/api/settings', 'PUT'],
    ['/api/reconciliation?date=2026-10-08', 'GET']
  ] as const;

  for (const [path, method] of ownerOnlyRequests) {
    const ownerResponse = proxy(request(path, ownerToken, method));
    assert.equal(ownerResponse.headers.get('x-middleware-next'), '1', `owner should pass ${method} ${path}`);

    const unauthenticatedResponse = proxy(request(path, undefined, method));
    assert.equal(unauthenticatedResponse.status, 401, `unauthenticated request should fail ${method} ${path}`);

    const adminResponse = proxy(request(path, adminToken, method));
    assert.equal(adminResponse.status, 403, `admin should fail ${method} ${path}`);

    const staffResponse = proxy(request(path, staffToken, method));
    assert.equal(staffResponse.status, 403, `staff should fail ${method} ${path}`);
  }
});

test('staff can still access daily entry APIs and cannot delete entries', () => {
  const readResponse = proxy(request('/api/daily', staffToken));
  assert.equal(readResponse.headers.get('x-middleware-next'), '1');

  const deleteResponse = proxy(request('/api/daily/entry-1', staffToken, 'DELETE'));
  assert.equal(deleteResponse.status, 403);
});
