module.exports = function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'clusterguard-pwa',
    message: 'ClusterGuard API is healthy'
  });
};
