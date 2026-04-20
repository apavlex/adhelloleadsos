const express = require('express');

const router = express.Router();

/** Legacy /outreach URLs → unified Prospecting hub */
router.use((req, res) => {
  const path = req.originalUrl.replace(/^\/outreach/, '/prospecting');
  res.redirect(302, path);
});

module.exports = router;
