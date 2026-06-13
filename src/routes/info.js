'use strict';

const os = require('os');
const express = require('express');

const router = express.Router();

const START_TIME = Date.now();

// Core business endpoint: returns server time + hostname.
router.get('/api/info', (req, res) => {
  const now = new Date();
  res.json({
    hostname: os.hostname(),
    serverTime: now.toISOString(),
    epochMs: now.getTime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: os.platform(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(process.uptime()),
    podStartTime: new Date(START_TIME).toISOString(),
    nodeVersion: process.version,
    // Useful in K8s to confirm which pod served the request.
    pod: process.env.POD_NAME || os.hostname(),
    namespace: process.env.POD_NAMESPACE || 'n/a',
    node: process.env.NODE_NAME || 'n/a',
  });
});

module.exports = router;
