const express = require('express');
const router = express.Router();
const { normalizeCustomMenuLinks } = require('../services/customMenuLinks');

router.get('/:id', (req, res) => {
  const links = normalizeCustomMenuLinks(req.workspace && req.workspace.customMenuLinks);
  const id = String(req.params.id || '').trim();
  const link = links.find((item) => item.id === id);
  if (!link) {
    return res.status(404).render('error', {
      message: 'That menu link is not on this workspace.',
      activePage: '',
    });
  }
  if (link.open === 'tab') {
    return res.redirect(link.url);
  }
  res.render('custom-menu', {
    title: `${link.label} · AdHello`,
    customMenuLink: link,
    activePage: 'custom-menu',
  });
});

module.exports = router;
