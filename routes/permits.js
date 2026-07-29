const express = require('express');
const router = express.Router();
const dbService = require('../services/database');
const workspaceIntegrations = require('../services/workspaceIntegrations');
const permitStackClient = require('../services/permitStackClient');
const { normalizePermitCategory } = require('../services/permitStackCategories');
const { normalizePermitStackCity } = require('../services/permitStackCities');
const { permitsToLeads } = require('../services/permitLeadEnrich');
const { resolveTargetFolder, leadMetadataForJobType } = require('../services/pipelineFolders');
const { JOB_TYPES } = require('../services/scrapeJobTypes');
const activationService = require('../services/activationService');
const { userEmail } = require('../services/workspaceService');
const { persistWorkspaceIcp } = require('../services/workspaceIcp');

router.post('/search', async (req, res, next) => {
  try {
    const wid = req.workspaceId;
    const {
      city,
      state,
      category,
      keyword,
      permitKeyword,
      permitCity,
      contractor,
      maxResults,
      zip,
      filed_after,
    } = req.body;
    const integrationEnv = await workspaceIntegrations.getResolvedIntegrationEnv(wid);

    if (!permitStackClient.isConfigured(integrationEnv)) {
      return res.status(503).render('error', {
        message:
          'Permit Stack is not configured. Add your API key under Workspace → Integrations → Permit Stack.',
        activePage: 'find',
      });
    }

    let resolvedCity = String(city || permitCity || '').trim();
    let resolvedState = String(state || '').trim();
    const knownCity = normalizePermitStackCity(resolvedCity || permitCity);
    if (knownCity) {
      resolvedCity = knownCity.city;
      if (knownCity.state) resolvedState = knownCity.state;
    } else if (resolvedCity) {
      return res.status(400).render('error', {
        message:
          `"${resolvedCity}" is not a supported Permit Stack city. Go to Find Leads → Permits and choose a city from the dropdown (804 supported jurisdictions).`,
        activePage: 'find',
      });
    }
    const resolvedZip = String(zip || '').trim();
    const resolvedCategory = normalizePermitCategory(category);
    const resolvedKeyword = String(permitKeyword || keyword || '').trim();
    const resolvedContractor = String(contractor || '').trim();
    const resolvedFiledAfter = String(filed_after || '').trim();

    if (!resolvedCity && !resolvedZip) {
      return res.status(400).render('error', {
        message: 'City or ZIP code is required for permit search.',
        activePage: 'find',
      });
    }

    const folderResolved = await resolveTargetFolder(wid, {
      folderKey: req.body.folderKey,
      newFolderName: req.body.newFolderName,
      jobType: JOB_TYPES.PERMITS,
      category: resolvedCategory,
      city: resolvedCity,
    });
    if (folderResolved.error) {
      return res.status(400).render('error', {
        message: folderResolved.error,
        activePage: 'find',
      });
    }

    const maxRes = Math.min(100, Math.max(1, parseInt(maxResults, 10) || 25));

    async function startBackgroundPermitRun() {
      await dbService.setActiveJob({
        type: 'permits_search',
        city: resolvedCity,
        state: resolvedState,
        category: resolvedCategory,
        keyword: resolvedKeyword,
        contractor: resolvedContractor,
        zip: resolvedZip,
        filed_after: resolvedFiledAfter,
        maxResults: maxRes,
      });

      setImmediate(async () => {
        try {
          const searchResult = await permitStackClient.searchPermitsWithFallback(
            {
              city: resolvedCity,
              state: resolvedState,
              category: resolvedCategory,
              keyword: resolvedKeyword,
              contractor_name: resolvedContractor,
              zip: resolvedZip,
              filed_after: resolvedFiledAfter,
              per_page: maxRes,
            },
            integrationEnv
          );

          const leadRows = permitsToLeads(searchResult.results, {
            workspaceId: wid,
            city: resolvedCity,
            state: resolvedState,
            category: resolvedCategory,
            folderKey: folderResolved.targetFolderKey,
          });

          let savedCount = 0;
          const saved = [];
          for (const row of leadRows) {
            const meta = leadMetadataForJobType(JOB_TYPES.PERMITS, {
              folderKey: folderResolved.targetFolderKey,
            });
            // eslint-disable-next-line no-await-in-loop
            const result = await dbService.saveLeadWithMeta({ ...row, ...meta, workspaceId: wid });
            saved.push(result);
            if (!result.merged) savedCount += 1;
          }

          const searchRecord = {
            jobType: JOB_TYPES.PERMITS,
            keyword: resolvedCategory || resolvedKeyword,
            category: resolvedCategory,
            permitKeyword: resolvedKeyword,
            permitContractor: resolvedContractor,
            zip: resolvedZip,
            filedAfter: resolvedFiledAfter,
            city: resolvedCity,
            state: resolvedState,
            maxResults: maxRes,
            targetFolderKey: folderResolved.targetFolderKey,
            targetFolderName: folderResolved.targetFolderName,
            resultCount: leadRows.length,
            savedCount,
            totalAvailable: searchResult.total,
            totalCapped: searchResult.totalCapped,
            relaxedFilters: searchResult.relaxedFilters || false,
            zeroWithOptionalFilters: searchResult.zeroWithOptionalFilters || false,
            results: leadRows,
            timestamp: new Date().toISOString(),
            workspaceId: wid,
          };
          const searchKey = await dbService.saveSearch(searchRecord);
          if (userEmail(req)) await activationService.recordEvent(userEmail(req), 'search_saved');
          await dbService.clearActiveJob({
            resultCount: leadRows.length,
            savedCount,
            totalAvailable: searchResult.total,
            searchKey,
            relaxedFilters: searchResult.relaxedFilters || false,
            zeroWithOptionalFilters: searchResult.zeroWithOptionalFilters || false,
          });
        } catch (err) {
          console.error('[PERMITS-BG] Permit search failed:', err);
          const msg = err && err.message ? String(err.message) : 'Permit search failed';
          await dbService.clearActiveJob({ failed: true, error: msg });
        }
      });
    }

    await persistWorkspaceIcp(wid, {
      keyword: resolvedCategory || resolvedKeyword || 'permits',
      city: resolvedCity,
      state: resolvedState,
      qty: maxRes,
    });
    await startBackgroundPermitRun();
    const qs = new URLSearchParams({ tab: 'pipeline', preset: 'permits', searchInProgress: '1' });
    if (folderResolved.targetFolderKey) qs.set('folderKey', folderResolved.targetFolderKey);
    res.redirect(`/prospecting?${qs.toString()}`);
  } catch (err) {
    console.error('Permit search error:', err);
    next(err);
  }
});

module.exports = router;
