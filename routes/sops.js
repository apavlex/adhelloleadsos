const express = require('express');
const router = express.Router();
const sopsService = require('../services/sops');
const { userEmail } = require('../services/workspaceService');

function parseStepsField(raw) {
  return String(raw || '');
}

function parseRelatedPathsField(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf('|');
      if (pipe === -1) return { href: line, label: line };
      return {
        label: line.slice(0, pipe).trim(),
        href: line.slice(pipe + 1).trim(),
      };
    });
}

function bodyToSopFields(body) {
  return {
    title: body && body.title,
    purpose: body && body.purpose,
    owner: body && body.owner,
    trigger: body && body.trigger,
    successMeasure: body && body.successMeasure,
    steps: parseStepsField(body && body.stepsText),
    relatedPaths: parseRelatedPathsField(body && body.relatedPathsText),
  };
}

function relatedPathsToText(paths) {
  if (!Array.isArray(paths) || !paths.length) return '';
  return paths.map((p) => `${p.label}|${p.href}`).join('\n');
}

router.get('/', async (req, res, next) => {
  try {
    const all = await sopsService.listSopsForWorkspace(req.workspaceId);
    const sops = sopsService.visibleSops(all);
    res.render('sops', {
      title: 'SOPs | Agency OS',
      activePage: 'sops',
      sops,
      formError: req.query.error ? String(req.query.error) : '',
      created: req.query.created === '1',
      deleted: req.query.deleted === '1',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/new', (req, res) => {
  res.render('sop_form', {
    title: 'New SOP | Agency OS',
    activePage: 'sops',
    mode: 'create',
    sop: {
      title: '',
      purpose: '',
      owner: 'Sales Development Representative (SDR)',
      trigger: '',
      successMeasure: '',
      steps: [''],
      relatedPaths: [],
    },
    stepsText: '',
    relatedPathsText: '',
    formError: '',
  });
});

router.post('/', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    const email = userEmail(req);
    const sop = await sopsService.createSop(req.workspaceId, bodyToSopFields(req.body), email);
    return res.redirect(`/sops/${encodeURIComponent(sop.id)}?saved=1`);
  } catch (err) {
    res.status(400).render('sop_form', {
      title: 'New SOP | Agency OS',
      activePage: 'sops',
      mode: 'create',
      sop: bodyToSopFields(req.body),
      stepsText: String((req.body && req.body.stepsText) || ''),
      relatedPathsText: String((req.body && req.body.relatedPathsText) || ''),
      formError: (err && err.message) || 'Could not save SOP.',
    });
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const sop = await sopsService.getSopForWorkspace(req.workspaceId, req.params.id);
    if (!sop || sop.deleted) return res.redirect('/sops');
    res.render('sop', {
      title: `${sop.title} | SOP | Agency OS`,
      activePage: 'sops',
      sop,
      saved: req.query.saved === '1',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const sop = await sopsService.getSopForWorkspace(req.workspaceId, req.params.id);
    if (!sop || sop.deleted) return res.redirect('/sops');
    res.render('sop_form', {
      title: `Edit ${sop.title} | SOP | Agency OS`,
      activePage: 'sops',
      mode: 'edit',
      sop,
      stepsText: (sop.steps || []).join('\n'),
      relatedPathsText: relatedPathsToText(sop.relatedPaths),
      formError: '',
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    if (String((req.body && req.body._method) || '').toUpperCase() === 'DELETE') {
      await sopsService.deleteSop(req.workspaceId, req.params.id);
      return res.redirect('/sops?deleted=1');
    }
    const email = userEmail(req);
    const sop = await sopsService.updateSop(
      req.workspaceId,
      req.params.id,
      bodyToSopFields(req.body),
      email,
    );
    return res.redirect(`/sops/${encodeURIComponent(sop.id)}?saved=1`);
  } catch (err) {
    const sop = {
      id: req.params.id,
      ...bodyToSopFields(req.body),
    };
    res.status(400).render('sop_form', {
      title: 'Edit SOP | Agency OS',
      activePage: 'sops',
      mode: 'edit',
      sop,
      stepsText: String((req.body && req.body.stepsText) || ''),
      relatedPathsText: String((req.body && req.body.relatedPathsText) || ''),
      formError: (err && err.message) || 'Could not save SOP.',
    });
  }
});

module.exports = router;
