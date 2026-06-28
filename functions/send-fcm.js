const { sendFcmToTokens } = require('../fcm');

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, message: 'Method not allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const result = await sendFcmToTokens({
      tokens,
      title: payload.title || 'SOS ClusterGuard',
      body: payload.body || 'Ada laporan darurat baru.',
      data: payload.data || {}
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
  } catch (error) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
