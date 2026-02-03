const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    title: 'Google Maps Lead Agent',
    activePage: 'search',
  });
});

module.exports = router;
