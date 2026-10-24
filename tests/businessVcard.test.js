const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const businessVcard = require('../services/businessVcard');
const { getBusinessVcardUrl } = require('../lib/publicBaseUrl');

describe('businessVcard', () => {
  it('builds vCard 3.0 with CRLF and escaped values', () => {
    const body = businessVcard.buildVcard({
      fn: 'Acme Floors',
      org: 'Acme Floors',
      contactName: 'John Cody',
      phone: '+15551234567',
      email: 'hi@acme.example',
      url: 'https://reviews.adhello.io/rv/acme-floors',
      photoUrl: 'https://reviews.adhello.io/rv/acme-floors/avatar.png?v=1',
    });
    assert.match(body, /^BEGIN:VCARD\r\n/);
    assert.match(body, /\r\nVERSION:3\.0\r\n/);
    assert.match(body, /\r\nFN:Acme Floors\r\n/);
    assert.match(body, /\r\nN:Cody;John;;;\r\n/);
    assert.match(body, /\r\nORG:Acme Floors\r\n/);
    assert.match(body, /\r\nTEL;TYPE=CELL,VOICE:\+15551234567\r\n/);
    assert.match(body, /\r\nEMAIL;TYPE=INTERNET:hi@acme\.example\r\n/);
    assert.match(body, /\r\nURL:https:\/\/reviews\.adhello\.io\/rv\/acme-floors\r\n/);
    assert.match(body, /\r\nPHOTO;VALUE=URI;TYPE=JPEG:https:\/\/reviews\.adhello\.io\/rv\/acme-floors\/avatar\.png\?v=1\r\n/);
    assert.match(body, /\r\nEND:VCARD\r\n$/);

    assert.equal(businessVcard.escapeVcardValue('A;B,C\\D\nE'), 'A\\;B\\,C\\\\D\\nE');
    const escaped = businessVcard.buildVcard({
      fn: 'A;B,C\\D',
      org: 'A;B',
    });
    assert.match(escaped, /FN:A\\;B\\,C\\\\D/);
  });

  it('builds a stable URL and filename from a member', () => {
    assert.equal(
      getBusinessVcardUrl('camas-flooring'),
      'https://reviews.adhello.io/c/camas-flooring.vcf',
    );
    const card = businessVcard.vcardFromMember({
      reviewSlug: 'camas-flooring',
      companyName: 'Camas Flooring',
      contactName: 'Pat Lee',
      phone: '3605551212',
      email: 'pat@example.com',
      profilePhotoUpdatedAt: '2026-01-01T00:00:00.000Z',
    });
    assert.ok(card);
    assert.equal(card.url, 'https://reviews.adhello.io/c/camas-flooring.vcf');
    assert.equal(card.filename, 'Camas-Flooring.vcf');
    assert.match(card.body, /FN:Camas Flooring/);
    assert.match(card.body, /TEL;TYPE=CELL,VOICE:3605551212/);
    assert.match(card.body, /PHOTO;VALUE=URI/);
    assert.equal(businessVcard.vcardFromMember({ companyName: 'No slug' }), null);
  });

  it('wires public route and Profile copy UI', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/businessVcardPublic.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const profile = fs.readFileSync(path.join(__dirname, '../views/member_app/profile.ejs'), 'utf8');
    const memberApp = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    assert.match(route, /\/c\/:slugVcf/);
    assert.match(route, /text\/vcard; charset=utf-8/);
    assert.match(route, /Content-Disposition/);
    assert.match(server, /businessVcardPublic/);
    assert.match(profile, /vcardUrl/);
    assert.match(profile, /Contact card \(vCard\)/);
    assert.match(profile, /data-ma-copy=/);
    assert.match(memberApp, /vcardUrl/);
    assert.match(memberApp, /businessVcard/);
  });

  it('serves /c/:slug.vcf with vcard headers', async () => {
    const store = require('../services/networkStore');
    const prevResolve = store.resolveReviewSlug;
    const prevGet = store.getMember;
    store.resolveReviewSlug = async (slug) => ({
      networkId: 'net1',
      memberId: 'm1',
      slug,
    });
    store.getMember = async () => ({
      id: 'm1',
      reviewSlug: 'acme-floors',
      companyName: 'Acme Floors',
      contactName: 'Alex',
      phone: '+15551230000',
      email: 'a@acme.test',
    });
    const app = express();
    app.use('/', require('../routes/businessVcardPublic'));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/c/acme-floors.vcf`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/vcard/);
      assert.match(res.headers.get('content-disposition') || '', /Acme-Floors\.vcf/);
      const text = await res.text();
      assert.match(text, /BEGIN:VCARD/);
      assert.match(text, /FN:Acme Floors/);
      assert.match(text, /\+15551230000/);

      const miss = await fetch(`http://127.0.0.1:${port}/c/missing.vcf`);
      store.resolveReviewSlug = async () => null;
      const miss2 = await fetch(`http://127.0.0.1:${port}/c/nope.vcf`);
      assert.equal(miss2.status, 404);
      void miss;
    } finally {
      store.resolveReviewSlug = prevResolve;
      store.getMember = prevGet;
      await new Promise((r) => server.close(r));
    }
  });
});
