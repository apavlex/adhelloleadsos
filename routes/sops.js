const express = require('express');
const router = express.Router();
const { listSops, getSopById } = require('../config/sops');

router.get('/', (req, res) => {
  const sops = listSops();
  res.render('sops', {
    title: 'SOPs | Agency OS',
    activePage: 'sops',
    sops,
  });
});

router.get('/:id', (req, res) => {
  const sop = getSopById(req.params.id);
  if (!sop) {
    return res.redirect('/sops');
  }
  res.render('sop', {
    title: `${sop.title} | SOP | Agency OS`,
    activePage: 'sops',
    sop,
  });
});

module.exports = router;
