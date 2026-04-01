const db = require('./services/database');
(async () => {
  try {
    const visits = await db.getAllVisits();
    console.log(`Total visits in DB: ${visits.length}`);
    if (visits.length > 0) {
      console.log('Latest visit:', visits[0]);
    }
  } catch (e) {
    console.error('DB check failed:', e.message);
  }
})();
