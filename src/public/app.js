'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot: $('status-dot'),
    statusText: $('status-text'),
    time: $('clock-time'),
    date: $('clock-date'),
    tz: $('clock-tz'),
    hostname: $('hostname'),
    pod: $('f-pod'),
    ns: $('f-ns'),
    node: $('f-node'),
    platform: $('f-platform'),
    uptime: $('f-uptime'),
    nodeVersion: $('f-node-version'),
    latency: $('latency'),
  };

  function setStatus(state, text) {
    els.statusDot.setAttribute('data-state', state);
    els.statusText.textContent = text;
  }

  function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m ${s}s`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function render(data, latencyMs) {
    const dt = new Date(data.serverTime);
    els.time.textContent = dt.toLocaleTimeString('en-GB', { hour12: false });
    els.date.textContent = dt.toLocaleDateString('en-CA');
    els.tz.textContent = data.timezone || 'UTC';
    els.hostname.textContent = data.hostname;
    els.pod.textContent = data.pod;
    els.ns.textContent = data.namespace;
    els.node.textContent = data.node;
    els.platform.textContent = `${data.platform}/${data.arch}`;
    els.uptime.textContent = fmtUptime(data.uptimeSeconds);
    els.nodeVersion.textContent = data.nodeVersion;
    els.latency.textContent = `${latencyMs} ms`;
    setStatus('live', 'live');
  }

  async function poll() {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/info', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      render(data, Math.round(performance.now() - t0));
    } catch (err) {
      setStatus('down', 'connection lost — retrying');
    }
  }

  setStatus('connecting', 'connecting…');
  poll();
  setInterval(poll, 2000);
})();
