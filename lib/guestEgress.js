/**
 * Outbound network firewall for public live-demo visitors.
 *
 * Code that runs inside `run(ctx, fn)` (and everything it schedules) can only
 * reach AI chat endpoints, and only while `ctx.onAiCall()` allows it. Every
 * other outbound connection (lead searches, enrichment, SMS, email, telephony,
 * image generation, headless Chrome) fails fast with a DEMO_DISABLED error.
 *
 * A ctx with `check(host, path)` meters instead of firewalls: each HTTP(S)
 * request is allowed or refused by that hook, and raw sockets / headless Chrome
 * stay open (used for trial workspaces).
 */
const { AsyncLocalStorage } = require('async_hooks');
const http = require('http');
const https = require('https');
const net = require('net');

const als = new AsyncLocalStorage();

const AI_HOSTS = new Set([
  'openrouter.ai',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.kie.ai',
]);

function isAiRequest(host, path) {
  const h = String(host || '').toLowerCase();
  if (!AI_HOSTS.has(h)) return false;
  const p = String(path || '');
  if (p.includes('/chat/completions')) return true;
  if (h === 'generativelanguage.googleapis.com') return /:(stream)?generateContent\b/.test(p);
  if (h === 'api.openai.com') return p.startsWith('/v1/audio/transcriptions');
  return false;
}

function demoError(reason) {
  const msg =
    reason === 'ai_budget'
      ? 'The live demo has used up its AI allowance. Book a call to see more.'
      : 'This feature is turned off in the live demo.';
  const err = new Error(msg);
  err.code = 'DEMO_DISABLED';
  err.demoBlocked = true;
  err.demoReason = reason;
  return err;
}

/** @returns {{ ok: boolean, reason?: string }} */
function evaluate(ctx, host, path) {
  if (typeof ctx.check === 'function') return ctx.check(host, path);
  if (!isAiRequest(host, path)) return { ok: false, reason: `blocked:${host || 'unknown'}` };
  if (typeof ctx.onAiCall === 'function' && !ctx.onAiCall()) return { ok: false, reason: 'ai_budget' };
  return { ok: true };
}

function current() {
  return als.getStore() || null;
}

function run(ctx, fn) {
  return als.run(ctx, fn);
}

function fetchTarget(input) {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url ? input.url : '';
  try {
    const u = new URL(raw);
    return { protocol: u.protocol, host: u.hostname, path: u.pathname + u.search };
  } catch {
    return { protocol: '', host: '', path: '' };
  }
}

function httpTarget(args) {
  const [a0, a1] = args;
  let url = null;
  let opts = {};
  if (typeof a0 === 'string' || a0 instanceof URL) {
    try {
      url = new URL(String(a0));
    } catch {
      url = null;
    }
    if (a1 && typeof a1 === 'object' && typeof a1 !== 'function') opts = a1;
  } else if (a0 && typeof a0 === 'object') {
    opts = a0;
  }
  if (opts.socketPath) return { socketPath: true };
  const host = String(opts.hostname || opts.host || (url && url.hostname) || 'localhost').replace(/:\d+$/, '');
  const path = String(opts.path || (url ? url.pathname + url.search : '/'));
  return { host, path };
}

/** An agent whose sockets fail immediately, so the request emits a normal 'error'. */
function failingAgent(mod, err) {
  const agent = new mod.Agent();
  agent.createConnection = () => {
    const socket = new net.Socket();
    process.nextTick(() => socket.destroy(err));
    return socket;
  };
  return agent;
}

function withAgent(args, agent) {
  const [a0, a1, a2] = args;
  if (typeof a0 === 'string' || a0 instanceof URL) {
    if (a1 && typeof a1 === 'object') return [a0, { ...a1, agent }, a2];
    return [a0, { agent }, a1];
  }
  return [{ ...(a0 || {}), agent }, a1];
}

function connectTarget(args) {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0];
  if (a0 && typeof a0 === 'object') {
    if (a0.path) return { socketPath: true };
    return { host: String(a0.host || a0.servername || 'localhost') };
  }
  if (typeof a0 === 'string' && Number.isNaN(Number(a0))) return { socketPath: true };
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
}

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  if (typeof globalThis.fetch === 'function') {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function guardedFetch(input, init) {
      const ctx = als.getStore();
      if (!ctx) return origFetch.call(this, input, init);
      const t = fetchTarget(input);
      if (t.protocol === 'data:' || t.protocol === 'blob:') return origFetch.call(this, input, init);
      const verdict = evaluate(ctx, t.host, t.path);
      if (!verdict.ok) return Promise.reject(verdict.error || demoError(verdict.reason));
      return origFetch.call(this, input, init);
    };
  }

  for (const mod of [http, https]) {
    for (const method of ['request', 'get']) {
      const orig = mod[method];
      mod[method] = function guardedRequest(...args) {
        const ctx = als.getStore();
        if (!ctx) return orig.apply(this, args);
        const t = httpTarget(args);
        if (t.socketPath) return orig.apply(this, args);
        const verdict = evaluate(ctx, t.host, t.path);
        if (verdict.ok) return orig.apply(this, args);
        return orig.apply(this, withAgent(args, failingAgent(mod, verdict.error || demoError(verdict.reason))));
      };
    }
  }

  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const ctx = als.getStore();
    if (ctx && !ctx.check) {
      const t = connectTarget(args);
      if (!t.socketPath && !AI_HOSTS.has(String(t.host).toLowerCase())) {
        const err = demoError(`blocked:${t.host}`);
        process.nextTick(() => this.destroy(err));
        return this;
      }
    }
    return origConnect.apply(this, args);
  };

  try {
    // eslint-disable-next-line global-require
    const puppeteer = require('puppeteer');
    for (const method of ['launch', 'connect']) {
      if (typeof puppeteer[method] !== 'function') continue;
      const orig = puppeteer[method].bind(puppeteer);
      puppeteer[method] = async (...args) => {
        const ctx = als.getStore();
        if (ctx && !ctx.check) throw demoError('blocked:browser');
        return orig(...args);
      };
    }
  } catch {
    /* puppeteer is optional */
  }
}

module.exports = {
  install,
  run,
  current,
  isAiRequest,
  demoError,
  AI_HOSTS,
};
