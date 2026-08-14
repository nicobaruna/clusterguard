// Vercel Serverless Function: /api/health (di-rewrite ke /health)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify({ status: 'ok', service: 'clusterguard-vercel-functions' }));
}
