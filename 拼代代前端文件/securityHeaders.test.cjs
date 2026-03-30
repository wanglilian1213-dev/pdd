const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSecurityHeaders } = require('./securityHeaders.cjs');

test('buildSecurityHeaders returns the required baseline headers', () => {
  const headers = buildSecurityHeaders({
    isHtml: true,
    isSecureRequest: true,
  });

  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains; preload');
});
