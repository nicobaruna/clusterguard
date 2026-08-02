import assert from 'node:assert/strict';
import { collectRecipientTokens } from './push-utils.mjs';

const tokens = collectRecipientTokens({
  tokenDocs: [{ token: 'doc-token' }, { fcmToken: 'doc-fallback' }],
  currentToken: 'current-token',
  fallbackTokens: ['fallback-token', '']
});

assert.deepEqual(tokens, ['doc-token', 'doc-fallback', 'current-token', 'fallback-token']);
console.log('push-utils regression test passed');
