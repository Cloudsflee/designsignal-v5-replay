import assert from 'node:assert/strict';
import test from 'node:test';
import { hostAllowed, isPublicAddress, readLimitedWebResponse, validatePublicUrl } from '../src/security.mjs';
import { redactSecrets } from '../src/util.mjs';

test('private, loopback, link-local, and mapped addresses are blocked', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.1.2', '192.168.1.2', '169.254.1.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('URL validation requires HTTPS, allowlist, and public DNS answers', async () => {
  await assert.rejects(
    validatePublicUrl('http://example.com/a', { allowedHosts: ['example.com'], resolver: async () => [{ address: '8.8.8.8', family: 4 }] }),
    { code: 'https_required' }
  );
  await assert.rejects(
    validatePublicUrl('https://other.example/a', { allowedHosts: ['example.com'], resolver: async () => [{ address: '8.8.8.8', family: 4 }] }),
    { code: 'host_not_allowed' }
  );
  await assert.rejects(
    validatePublicUrl('https://example.com/a', { allowedHosts: ['example.com'], resolver: async () => [{ address: '127.0.0.1', family: 4 }] }),
    { code: 'private_network_forbidden' }
  );
  const validated = await validatePublicUrl('https://news.example.com/a', {
    allowedHosts: ['*.example.com'],
    resolver: async () => [{ address: '8.8.8.8', family: 4 }]
  });
  assert.equal(validated.hostname, 'news.example.com');
  assert.equal(hostAllowed('example.com', ['*.example.com']), false);
});

test('stream byte limit aborts oversized bodies', async () => {
  const response = new Response('0123456789', { headers: { 'content-type': 'text/plain' } });
  await assert.rejects(readLimitedWebResponse(response, 5), { code: 'response_too_large' });
  const accepted = await readLimitedWebResponse(new Response('12345'), 5);
  assert.equal(accepted.toString(), '12345');
});

test('redaction removes bearer tokens, API keys, query secrets, and explicit values', () => {
  const secret = 'my-super-secret-value';
  const text = redactSecrets(
    `Bearer abcdefghijklmnop sk-abcdefghijklmnop https://x.test/?token=abcdefghi ${secret} {"api_key":"abcdefghi"}`,
    [secret]
  );
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes('abcdefghijklmnop'), false);
  assert.equal(text.includes('abcdefghi'), false);
  assert.match(text, /REDACTED/);
});
