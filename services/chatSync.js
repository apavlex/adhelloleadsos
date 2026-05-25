/**
 * Cross-platform chat sync service.
 * Keeps AdHello CEO chat and Telegram in sync.
 * 
 * Usage from Hermes agent (Telegram):
 *   const chatSync = require('./services/chatSync');
 *   await chatSync.pushToAdHello(role, content, source);
 *   const history = await chatSync.getUnifiedHistory(limit);
 * 
 * Usage from CEO chat (web):
 *   Automatic via webhook in routes/ceo.js
 */

const https = require('https');
const http = require('http');

const API_INGEST_KEY = process.env.API_INGEST_KEY || 'a83843d84df7cf9457d6b674847c8938';
const ADHELLO_BASE_URL = process.env.ADHELLO_BASE_URL || 'https://adhelloleadsos.onrender.com';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7325499142';

function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_INGEST_KEY,
      },
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { resolve({ raw: chunks }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(url, {
      headers: { 'x-api-key': API_INGEST_KEY },
    }, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { resolve({ raw: chunks }); }
      });
    }).on('error', reject).setTimeout(10000, function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function telegramSend(text) {
  if (!TELEGRAM_BOT_TOKEN) return { error: 'no token' };
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  return httpPost(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'Markdown',
  });
}

const chatSync = {
  // Push a message from any channel into the AdHello chat DB
  async pushToAdHello(role, content, source) {
    return httpPost(`${ADHELLO_BASE_URL}/api/chat/message`, {
      role,
      content,
      source: source || 'telegram',
    });
  },

  // Get unified chat history from AdHello DB
  async getAdHelloHistory(limit) {
    const result = await httpGet(`${ADHELLO_BASE_URL}/api/chat/history?limit=${limit || 50}`);
    return result && result.messages ? result.messages : [];
  },

  // Push a message from Telegram to AdHello AND get the AI reply
  async telegramToAdHello(userMessage, history) {
    // Store the user message
    await this.pushToAdHello('user', userMessage, 'telegram');
    return { success: true, note: 'Message saved to AdHello chat history' };
  },

  // Push a message from AdHello to Telegram notification
  async adhelloToTelegram(userMessage, aiReply) {
    const msg = `💬 *AdHello CEO Chat*\n\n👤 You: ${userMessage.substring(0, 200)}\n\n😊 Pavlex: ${aiReply.substring(0, 300)}${aiReply.length > 300 ? '...' : ''}`;
    return telegramSend(msg);
  },

  // Full sync status
  async getSyncStatus() {
    const history = await this.getAdHelloHistory(5);
    return {
      adhelloMessages: history.length,
      lastMessage: history.length > 0 ? history[history.length - 1] : null,
      telegramConfigured: !!TELEGRAM_BOT_TOKEN,
      adhelloConfigured: !!API_INGEST_KEY,
    };
  },
};

module.exports = chatSync;
