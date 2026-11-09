import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/health/route';
import { proxy } from '../proxy';

test('health endpoint returns public status JSON without accessing MongoDB', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });

  const request = new NextRequest('https://example.test/api/health');
  const proxyResponse = proxy(request);
  assert.equal(proxyResponse.headers.get('x-middleware-next'), '1');
});
