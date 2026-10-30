const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-qa-'));
process.env.APP_DATA_DIR = tmpDir;

const dbService = require('../services/database');
const notificationLog = require('../services/notificationLog');
const seoQaStore = require('../services/seoQaStore');
const seoQaImport = require('../services/seoQaImport');
const seoQaPublic = require('../services/seoQaPublic');

const WID = 'ws_seo_qa_test';
const NOTIF_KEY = `notificationLog:${WID}`;

const SAMPLE_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Is LVP flooring waterproof?","acceptedAnswer":{"@type":"Answer","text":"Most rigid-core LVP planks are waterproof."}},
  {"@type":"Question","name":"What is the best flooring for dogs?","acceptedAnswer":{"@type":"Answer","text":"Rigid-core LVP or waterproof laminate."}}
]}
</script>
</head><body>
<article>
  <button aria-label="Upvote this question"><span>12</span></button>
  <div>
    <div><span>Pets</span><span> Answered</span><span>Golden Retriever Owner · 6d ago</span></div>
    <h3>What is the best flooring for dogs?</h3>
    <p>Choose textured surfaces so dogs get better grip.</p>
    <div><p>TPR Flooring &amp; Design</p><p>For most dog owners, rigid-core LVP works best.</p></div>
  </div>
</article>
<article>
  <button aria-label="Upvote this question"><span>3</span></button>
  <div>
    <div><span>Hardwood</span><span> Open</span><span>Devin · 5h ago</span></div>
    <h3>Any tips for matching new hardwood to a 1990s red oak staircase?</h3>
    <p>Only replacing the main floor.</p>
  </div>
</article>
</body></html>`;

describe('SEO Q&A Pages', () => {
  before(async () => {
    await dbService.saveWorkspace(WID, {
      id: WID,
      name: 'TPR Test Co',
      members: { 'owner@test.com': { role: 'owner' } },
      salesIntake: { businessName: 'TPR Flooring & Design' },
    });
  });

  beforeEach(() => {
    try {
      dbService.deleteKvSync(NOTIF_KEY);
    } catch (_) {
      /* ignore */
    }
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('wires nav, permissions, and public + dashboard routes', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const nav = fs.readFileSync(path.join(__dirname, '../views/partials/app_nav_items.ejs'), 'utf8');
    const seoNav = fs.readFileSync(path.join(__dirname, '../views/partials/seo_local_rank_nav.ejs'), 'utf8');
    const perms = fs.readFileSync(path.join(__dirname, '../services/rolePermissions.js'), 'utf8');
    const publicRoute = fs.readFileSync(path.join(__dirname, '../routes/seoQaPublic.js'), 'utf8');
    const iaNav = fs.readFileSync(path.join(__dirname, '../middleware/iaNav.js'), 'utf8');
    assert.match(server, /\/seo-qa/);
    assert.match(server, /seoQaPublicRoutes/);
    assert.match(publicRoute, /\/api\/public\/seo-qa\/:token\/feed\.json/);
    assert.match(publicRoute, /\/api\/public\/seo-qa\/:token\/questions/);
    assert.match(nav, /href="\/seo-qa"/);
    assert.match(seoNav, /href="\/seo-qa"/);
    assert.match(perms, /id: 'seo-qa'/);
    assert.match(iaNav, /navPrimary = 'seo-qa'/);
    const seoLabelIdx = nav.indexOf('SEO / Local Rank');
    const qaHrefIdx = nav.indexOf('href="/seo-qa"');
    assert.ok(seoLabelIdx >= 0 && qaHrefIdx > seoLabelIdx);
  });

  it('parses FAQ schema and article markup from HTML', () => {
    const faq = seoQaImport.extractFaqSchema(SAMPLE_HTML);
    assert.ok(faq.length >= 2);
    const articles = seoQaImport.extractArticles(SAMPLE_HTML);
    assert.ok(articles.some((a) => /dogs/i.test(a.question)));
    assert.ok(articles.some((a) => a.status === 'open'));
    const merged = seoQaImport.mergeImportRows(faq, articles);
    const dogs = merged.find((r) => /dogs/i.test(r.question));
    assert.ok(dogs);
    assert.ok(dogs.answer);
    assert.equal(dogs.category, 'Pets');
  });

  it('imports, publishes feed with FAQ schema, and notifies on submit', async () => {
    const merged = seoQaImport.mergeImportRows(
      seoQaImport.extractFaqSchema(SAMPLE_HTML),
      seoQaImport.extractArticles(SAMPLE_HTML)
    );
    await seoQaStore.mergeImported(WID, merged, { publishImported: true });
    let bundle = await seoQaStore.ensurePublicToken(WID);
    assert.ok(bundle.settings.publicToken.startsWith('sqa_'));
    assert.ok(seoQaStore.inboxSummary(bundle).published >= 1);

    const token = bundle.settings.publicToken;
    const feed = await seoQaPublic.getPublicFeed(token);
    assert.ok(Array.isArray(feed.questions));
    assert.ok(feed.questions.length >= 1);
    assert.equal(feed.faq_schema['@type'], 'FAQPage');
    assert.ok(feed.faq_schema.mainEntity.length >= 1);

    const submitted = await seoQaPublic.submitPublicQuestion(
      token,
      {
        question: 'Will LVP feel cold in a Camas basement in winter?',
        category: 'LVP & Vinyl',
        author: 'Maria',
        context: 'Finishing a 600 sq ft basement.',
      },
      { ip: '203.0.113.10' }
    );
    assert.equal(submitted.status, 'open');
    const notifs = notificationLog.list(WID);
    assert.ok(notifs.some((n) => /Q&A question/i.test(n.title)));
    assert.ok(notifs.some((n) => String(n.href || '').includes('/seo-qa')));

    bundle = await seoQaStore.load(WID);
    const open = seoQaStore.listQuestions(bundle, { status: 'open' });
    assert.ok(open.some((q) => /basement/i.test(q.question)));

    const answered = await seoQaStore.answerQuestion(WID, submitted.id, {
      answer: 'Use a concrete-rated underlayment compatible with your click system.',
      answerBy: 'TPR Flooring & Design',
      publish: true,
    });
    assert.equal(answered.published, true);
    const feed2 = await seoQaPublic.getPublicFeed(token);
    assert.ok(feed2.questions.some((q) => /basement/i.test(q.question)));
  });

  it('rejects invalid public tokens', async () => {
    await assert.rejects(() => seoQaPublic.getPublicFeed('sqa_notreal'), /Invalid|unknown/i);
  });
});
