const express = require('express');
const router = express.Router();
const dbService = require('../services/database');

router.get('/', async (req, res) => {
  const leads = await dbService.getAllLeads();
  res.render('index', {
    title: 'Google Maps Lead Agent',
    activePage: 'search',
    savedLeadsCount: leads.length
  });
});

module.exports = router;
