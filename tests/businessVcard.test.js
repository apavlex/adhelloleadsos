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
      website: 'https://acmefloors.example',
      reviewUrl: 'https://reviews.adhello.io/rv/acme-floors',
      photoUrl: 'https://reviews.adhello.io/rv/acme-floors/logo.png?v=1',
    });
    assert.match(body, /^BEGIN:VCARD\r\n/);
    assert.match(body, /\r\nVERSION:3\.0\r\n/);
    assert.match(body, /\r\nFN:Acme Floors\r\n/);
    // Company card: empty N so iOS doesn’t put the owner in First Name.
    assert.match(body, /\r\nN:;;;;\r\n/);
    assert.match(body, /\r\nX-ABShowAs:COMPANY\r\n/);
    assert.match(body, /\r\nORG:Acme Floors\r\n/);
    assert.match(body, /\r\nTITLE:John Cody\r\n/);
    assert.match(body, /\r\nTEL;TYPE=WORK,VOICE:\+15551234567\r\n/);
    assert.doesNotMatch(body, /TEL;TYPE=CELL/);
    assert.match(body, /\r\nEMAIL;TYPE=INTERNET:hi@acme\.example\r\n/);
    assert.match(body, /\r\nURL;TYPE=WORK:https:\/\/acmefloors\.example\r\n/);
    assert.match(body, /\r\nURL:https:\/\/reviews\.adhello\.io\/rv\/acme-floors\r\n/);
    assert.match(body, /\r\nPHOTO;VALUE=URI;TYPE=JPEG:https:\/\/reviews\.adhello\.io\/rv\/acme-floors\/logo\.png\?v=1\r\n/);
    assert.match(body, /\r\nLOGO;VALUE=URI;TYPE=JPEG:https:\/\/reviews\.adhello\.io\/rv\/acme-floors\/logo\.png\?v=1\r\n/);
    assert.match(body, /\r\nNOTE:Contact: John Cody\r\n/);
    assert.match(body, /\r\nEND:VCARD\r\n$/);
    assert.equal(businessVcard.usablePhone('N/A'), '');
    assert.equal(businessVcard.usablePhone('alex@adhello.io'), '');
    assert.equal(businessVcard.usablePhone('(360) 555-1212'), '(360) 555-1212');
    // Embedded App branding logo (what iOS actually shows on the contact).
    const tinyJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
      'base64',
    );
    const withEmbed = businessVcard.buildVcard({
      fn: 'Acme Floors',
      org: 'Acme Floors',
      photoBuffer: tinyJpeg,
      photoContentType: 'image/jpeg',
      uid: 'adhello-biz-acme-floors',
      rev: '20261024T120000Z',
    });
    assert.match(withEmbed, /PHOTO;ENCODING=b;TYPE=JPEG:/);
    assert.match(withEmbed, /LOGO;ENCODING=b;TYPE=JPEG:/);
    assert.match(withEmbed, /UID:adhello-biz-acme-floors/);
    assert.match(withEmbed, /REV:20261024T120000Z/);
    assert.doesNotMatch(withEmbed, /PHOTO;VALUE=URI/);
    assert.match(businessVcard.foldVcardLine('A'.repeat(80)), /\r\n /);

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
      reviewLogoUpdatedAt: '2026-01-01T00:00:00.000Z',
      reviewLinks: { other: [{ label: 'Website', url: 'https://camasflooring.example' }] },
    });
    assert.ok(card);
    assert.equal(card.url, 'https://reviews.adhello.io/c/camas-flooring.vcf');
    assert.equal(card.filename, 'Camas-Flooring.vcf');
    assert.match(card.body, /FN:Camas Flooring/);
    assert.match(card.body, /TEL;TYPE=WORK,VOICE:3605551212/);
    assert.doesNotMatch(card.body, /TEL;TYPE=CELL/);
    assert.match(card.body, /URL;TYPE=WORK:https:\/\/camasflooring\.example/);
    assert.match(card.body, /PHOTO;VALUE=URI.*logo\.png/);
    assert.match(card.body, /UID:adhello-biz-camas-flooring/);
    assert.match(card.body, /REV:20260101T000000Z/);
    // URI fallback is business logo only — never personal Profile photo / avatar.
    const logoOnly = businessVcard.photoUriForMember({
      reviewSlug: 'camas-flooring',
      reviewLogoUpdatedAt: '2026-02-01T00:00:00.000Z',
      profilePhotoUpdatedAt: '2026-03-01T00:00:00.000Z',
    });
    assert.match(logoOnly, /\/rv\/camas-flooring\/logo\.png/);
    assert.doesNotMatch(logoOnly, /avatar/);
    assert.equal(
      businessVcard.photoUriForMember({
        reviewSlug: 'camas-flooring',
        profilePhotoUpdatedAt: '2026-03-01T00:00:00.000Z',
      }),
      '',
    );
    // Embedded branding logo wins over URI.
    const embedded = businessVcard.vcardFromMember(
      {
        reviewSlug: 'camas-flooring',
        companyName: 'Camas Flooring',
        reviewLogoUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
      { photoBuffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), photoContentType: 'image/jpeg' },
    );
    assert.match(embedded.body, /PHOTO;ENCODING=b;TYPE=JPEG:/);
    assert.match(embedded.body, /LOGO;ENCODING=b;TYPE=JPEG:/);
    assert.doesNotMatch(embedded.body, /PHOTO;VALUE=URI/);
    assert.equal(businessVcard.vcardFromMember({ companyName: 'No slug' }), null);
    // Lead phone fills in when the member profile phone is empty.
    const fromLead = businessVcard.vcardFromMember(
      {
        reviewSlug: 'camas-flooring',
        companyName: 'Camas Flooring',
        contactName: 'Pat',
        phone: '',
        email: '',
      },
      { phone: '3605559999', email: 'office@camas.example' },
    );
    assert.match(fromLead.body, /TEL;TYPE=WORK,VOICE:3605559999/);
    assert.match(fromLead.body, /EMAIL;TYPE=INTERNET:office@camas\.example/);
  });

  it('wires public route and Profile copy UI', () => {
    const route = fs.readFileSync(path.join(__dirname, '../routes/businessVcardPublic.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const profile = fs.readFileSync(path.join(__dirname, '../views/member_app/profile.ejs'), 'utf8');
    const memberApp = fs.readFileSync(path.join(__dirname, '../routes/memberApp.js'), 'utf8');
    assert.match(route, /\/c\/:slugVcf/);
    assert.match(route, /text\/vcard; charset=utf-8/);
    assert.match(route, /Content-Disposition/);
    assert.match(route, /leadExtrasForMember/);
    assert.match(route, /brandingPhotoForMember/);
    assert.match(route, /prepareBrandingPhoto|photoBuffer/);
    assert.match(route, /no-store/);
    assert.match(server, /businessVcardPublic/);
    assert.match(profile, /vcardUrl/);
    assert.match(profile, /Contact card \(vCard\)/);
    assert.match(profile, /App branding/);
    assert.match(profile, /not your Profile photo|Contact photo preview/);
    assert.match(profile, /vcardHasPhone|No phone on this card/);
    assert.match(profile, /data-ma-copy=/);
    assert.match(memberApp, /vcardUrl/);
    assert.match(memberApp, /businessVcard/);
    assert.match(memberApp, /vcardHasPhone/);
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
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
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
