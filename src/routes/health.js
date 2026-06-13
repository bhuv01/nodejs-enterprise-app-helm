'use strict';

const express = require('express');

const router = express.Router();

let ready = false;

// Mark the app ready after startup work completes.
function setReady(value) {
  ready = value;
}

// Liveness: is the process alive? Keep this dependency-free and fast.
router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Readiness: should the pod receive traffic?
router.get('/readyz', (req, res) => {
  if (!ready) {
    return res.status(503).json({ status: 'not_ready' });
  }
  return res.status(200).json({ status: 'ready' });
});

module.exports = { router, setReady };
