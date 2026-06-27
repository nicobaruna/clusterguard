const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFcmMessage } = require('../fcm');

test('buildFcmMessage formats notification payload for a token', () => {
  const message = buildFcmMessage({
    token: 'device-token-123',
    title: 'SOS ClusterGuard',
    body: 'Ada laporan darurat baru',
    data: { type: 'sos_alert', sosId: 'abc123' }
  });

  assert.equal(message.token, 'device-token-123');
  assert.deepEqual(message.notification, {
    title: 'SOS ClusterGuard',
    body: 'Ada laporan darurat baru'
  });
  assert.deepEqual(message.data, {
    type: 'sos_alert',
    sosId: 'abc123'
  });
});
