/**
 * Lead enrichment via MoltSets — email, LinkedIn, decision-maker, optional mobile.
 * Uses company domain + known contact name when available; reverse-looks up emails.
 */

const moltsets = require('./moltsetsClient');
const { extractDomain } = require('./betterContactClient');
const { normalizeSocialUrl } = require('./socialUrlNormalize');

const OWNER_TITLES = ['Owner', 'CEO', 'Founder', 'President', 'Principal', 'Managing Member'];

function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(v || '').trim());
}

function hasValue(v) {
  const s = String(v == null ? '' : v).trim();
  return !!(s && s !== 'N/A');
}

function splitPersonName(raw) {
  const name = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) return { first: '', last: '', full: '' };
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: '', full: name };
  return { first: parts[0], last: parts.slice(1).join(' '), full: name };
}

function preferEmail(...candidates) {
  for (const c of candidates) {
    const email = String(c || '').trim();
    if (looksLikeEmail(email)) return email;
  }
  return '';
}

function profileToExtract(profile) {
  if (!profile || typeof profile !== 'object') return {};
  const out = {};
  const first = String(profile.first_name || profile.firstName || '').trim();
  const last = String(profile.last_name || profile.lastName || '').trim();
  const full =
    String(profile.full_name || profile.fullName || '').trim() ||
    [first, last].filter(Boolean).join(' ').trim();
  const title = String(profile.title || profile.job_title || '').trim();
  const linkedinRaw = String(
    profile.linkedin_url || profile.linkedinurl || profile.linkedinUrl || profile.linkedin || '',
  ).trim();
  const email = preferEmail(
    profile.email,
    profile.business_email,
    profile.work_email_confirmed,
    Array.isArray(profile.personal_emails) ? profile.personal_emails[0] : '',
  );
  const phone = String(
    profile.mobile_phone || profile.phone || profile.mobile || '',
  ).trim();

  if (email) out.email = email;
  if (phone) out.phone = phone;
  if (linkedinRaw) {
    const linkedin = normalizeSocialUrl(linkedinRaw.startsWith('http') ? linkedinRaw : `https://${linkedinRaw}`, 'linkedin');
    if (linkedin) out.linkedin = linkedin;
  }
  if (full) out.decision_maker_name = full.slice(0, 120);
  if (title) out.decision_maker_title = title.slice(0, 120);
  const risk = profile.risk_score || profile.work_email_confirmed_risk_score;
  if (risk) out.email_validation_status = String(risk).slice(0, 80);
  if (profile.last_validated_at || profile.work_email_confirmed_status) {
    const when = profile.last_validated_at || profile.work_email_confirmed_status;
    out.email_validation_status = out.email_validation_status
      ? `${out.email_validation_status} · ${when}`
      : String(when).slice(0, 80);
  }
  return out;
}

function mergeExtract(base, next) {
  const out = { ...(base || {}) };
  if (!next || typeof next !== 'object') return out;
  for (const [k, v] of Object.entries(next)) {
    if (v == null || v === '' || v === 'N/A') continue;
    if (!hasValue(out[k])) out[k] = v;
  }
  return out;
}

function extractHasSignal(extract) {
  if (!extract || typeof extract !== 'object') return false;
  return Boolean(
    (extract.email && extract.email !== 'N/A') ||
      (extract.phone && extract.phone !== 'N/A') ||
      extract.linkedin ||
      extract.decision_maker_name,
  );
}

function pickBestPerson(people, lead) {
  const list = Array.isArray(people) ? people.filter(Boolean) : [];
  if (!list.length) return null;
  const city = String((lead && lead.city) || '')
    .toLowerCase()
    .trim();
  const state = String((lead && lead.state) || '')
    .toLowerCase()
    .trim();
  const scored = list.map((p) => {
    let score = Number(p._score) || 0;
    const pCity = String(p.city || '').toLowerCase();
    const pState = String(p.state || p.region || '').toLowerCase();
    if (city && pCity && (pCity.includes(city) || city.includes(pCity))) score += 2;
    if (state && pState && (pState.includes(state) || state.includes(pState))) score += 1;
    if (p.business_email) score += 3;
    if (p.linkedin_url || p.linkedinurl) score += 1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].p;
}

/**
 * Enrich a pipeline lead with MoltSets.
 * @param {object} lead
 * @param {object} integrationEnv
 * @param {{ includeMobile?: boolean }} [opts]
 */
async function enrichLeadForBusiness(lead, integrationEnv, opts = {}) {
  if (!moltsets.isConfigured(integrationEnv)) {
    return { used: false, skipped: true, reason: 'not_configured', extract: {} };
  }
  if (!lead || typeof lead !== 'object') {
    return { used: false, skipped: true, reason: 'no_lead', extract: {} };
  }

  const domain = extractDomain(lead.website || lead.companyDomain || lead.url);
  const existingEmail = hasValue(lead.email) ? String(lead.email).trim() : '';
  const existingLinkedin = hasValue(lead.linkedin) ? String(lead.linkedin).trim() : '';
  const person = splitPersonName(lead.decisionMakerName);
  const includeMobile = opts.includeMobile !== false;
  const steps = [];
  let extract = {};

  // 1) Reverse email → name / title / LinkedIn / alt emails
  if (existingEmail && looksLikeEmail(existingEmail)) {
    try {
      const rev = await moltsets.reverseEmailLookup(existingEmail, integrationEnv);
      steps.push('reverse_email_lookup');
      if (rev.status === 'ok') {
        extract = mergeExtract(extract, profileToExtract(rev.results));
        // Keep the lead's known email if reverse only returned hashes/alt mailboxes.
        if (!extract.email) extract.email = existingEmail;
      }
    } catch (e) {
      if (e && e.code === 'insufficient_tokens') throw e;
      console.warn('[moltsetsLeadEnrich] reverse_email_lookup failed:', e && e.message);
    }
  }

  // 2) Name + domain → business email + LinkedIn
  if (!hasValue(extract.email) && domain && person.full) {
    try {
      const found = await moltsets.searchBusinessEmailByName(
        {
          name: person.full,
          first_name: person.first,
          last_name: person.last,
          company: domain,
        },
        integrationEnv,
      );
      steps.push('search_business_email_by_name');
      if (found.status === 'ok') {
        extract = mergeExtract(extract, profileToExtract(found.results));
        if (!extract.decision_maker_name) extract.decision_maker_name = person.full;
      }
    } catch (e) {
      if (e && e.code === 'insufficient_tokens') throw e;
      console.warn('[moltsetsLeadEnrich] search_business_email_by_name failed:', e && e.message);
    }
  }

  // 3) People search at company domain for owner/CEO, then email finder
  if (!hasValue(extract.email) && domain) {
    try {
      const peopleRes = await moltsets.searchPeople(
        {
          company_domain: domain,
          title: OWNER_TITLES,
          size: 5,
          ...(lead.country ? { country: lead.country } : { country: 'United States' }),
          ...(lead.state ? { state: lead.state } : {}),
          ...(lead.city ? { city: lead.city } : {}),
        },
        integrationEnv,
      );
      steps.push('search_people');
      const people = moltsets.peopleFromSearchResults(peopleRes.results);
      const best = pickBestPerson(people, lead);
      if (best) {
        extract = mergeExtract(extract, profileToExtract(best));
        if (!hasValue(extract.email)) {
          const name = String(best.full_name || [best.first_name, best.last_name].filter(Boolean).join(' ')).trim();
          if (name) {
            const found = await moltsets.searchBusinessEmailByName(
              { name, company: domain },
              integrationEnv,
            );
            steps.push('search_business_email_by_name');
            if (found.status === 'ok') {
              extract = mergeExtract(extract, profileToExtract(found.results));
            }
          }
        }
      }
    } catch (e) {
      if (e && e.code === 'insufficient_tokens') throw e;
      console.warn('[moltsetsLeadEnrich] search_people failed:', e && e.message);
    }
  }

  // 4) LinkedIn → business email
  const linkedin = hasValue(extract.linkedin) ? extract.linkedin : existingLinkedin;
  if (!hasValue(extract.email) && linkedin) {
    try {
      const found = await moltsets.linkedinToBusinessEmail(linkedin, integrationEnv);
      steps.push('linkedin_to_business_email');
      if (found.status === 'ok') {
        extract = mergeExtract(extract, profileToExtract({ ...found.results, linkedin_url: linkedin }));
      }
    } catch (e) {
      if (e && e.code === 'insufficient_tokens') throw e;
      console.warn('[moltsetsLeadEnrich] linkedin_to_business_email failed:', e && e.message);
    }
  }

  // 5) Optional carrier-verified mobile (separate phone-token balance)
  if (
    includeMobile &&
    linkedin &&
    !hasValue(extract.phone) &&
    !hasValue(lead.phone)
  ) {
    try {
      const phoneRes = await moltsets.linkedinToMobilePhone(linkedin, integrationEnv);
      steps.push('linkedin_to_mobile_phone');
      if (phoneRes.status === 'ok') {
        extract = mergeExtract(extract, profileToExtract(phoneRes.results));
      }
    } catch (e) {
      // Phone tokens are a separate paid add-on — skip quietly when unavailable.
      if (e && (e.code === 'insufficient_phone_tokens' || e.code === 'plan_restricted')) {
        steps.push('linkedin_to_mobile_phone_skipped');
      } else {
        console.warn('[moltsetsLeadEnrich] linkedin_to_mobile_phone failed:', e && e.message);
      }
    }
  }

  const used = extractHasSignal(extract);
  return {
    used,
    skipped: !used,
    reason: used ? 'ok' : 'not_found',
    extract,
    steps,
    source: 'moltsets',
  };
}

module.exports = {
  OWNER_TITLES,
  enrichLeadForBusiness,
  profileToExtract,
  extractHasSignal,
  pickBestPerson,
  splitPersonName,
  looksLikeEmail,
};
