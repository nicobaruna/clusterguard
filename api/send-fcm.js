import { sendFcmToTokens } from '../fcm.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  try {
    const payload = req.body || {};
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
    const result = await sendFcmToTokens({
      tokens,
      title: payload.title || 'SOS ClusterGuard',
      body: payload.body || 'Ada laporan darurat baru.',
      data: payload.data || {}
    });

    if (result?.error) {
      res.status(500).json({ success: false, message: result.error, ...result });
      return;
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
