import assert from 'node:assert/strict';
import { collectRecipientTokens, groupRecipientTokensBySource } from './push-utils.mjs';

const tokens = collectRecipientTokens({
  tokenDocs: [{ token: 'doc-token' }, { fcmToken: 'doc-fallback' }],
  currentToken: 'current-token',
  fallbackTokens: ['fallback-token', '']
});

assert.deepEqual(tokens, ['doc-token', 'doc-fallback', 'current-token', 'fallback-token']);

const grouped = groupRecipientTokensBySource({
  tokenDocs: [
    { token: 'web-doc-token', source: 'web' },
    { token: 'android-doc-token', source: 'android' },
    { token: 'android-doc-token', source: 'android' }
  ],
  currentToken: 'web-current-token',
  currentDeviceType: 'web',
  fallbackTokens: ['android-fallback-token']
});

assert.deepEqual(grouped, {
  web: ['web-doc-token', 'web-current-token'],
  android: ['android-doc-token', 'android-fallback-token']
});

console.log('push-utils regression test passed');
