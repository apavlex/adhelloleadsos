const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'push-alerts.js'), 'utf8');

function strictAtob(s) {
  if (s.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('The string to be decoded is not correctly encoded.');
  return Buffer.from(s, 'base64').toString('latin1');
}

const keyToBytes = new Function('atob', `${src.match(/function keyToBytes[\s\S]*?\n  }\n/)[0]}; return keyToBytes;`)(strictAtob);

test('push key decodes for every VAPID public key length', () => {
  for (let i = 0; i < 50; i += 1) {
    const bytes = keyToBytes(webpush.generateVAPIDKeys().publicKey);
    assert.strictEqual(bytes.length, 65);
    assert.strictEqual(bytes[0], 4);
  }
});

test('push key tolerates quotes, whitespace and existing padding', () => {
  const key = webpush.generateVAPIDKeys().publicKey;
  const expected = Array.from(keyToBytes(key));
  assert.deepStrictEqual(Array.from(keyToBytes(`"${key}"\n`)), expected);
  assert.deepStrictEqual(Array.from(keyToBytes(`${key}=`)), expected);
});
