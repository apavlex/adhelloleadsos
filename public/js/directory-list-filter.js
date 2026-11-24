/**
 * Directory dashboard listing search.
 * Understands "Vancouver, WA", a state name, and US/Canadian postal codes.
 * Also used on the server when a listing is saved so zip is kept even if the
 * street address omits it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DirectoryListFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Lowercase abbr → lowercase full name. US + DC + Canadian provinces. */
  var STATE_NAMES = {
    al: 'alabama',
    ak: 'alaska',
    az: 'arizona',
    ar: 'arkansas',
    ca: 'california',
    co: 'colorado',
    ct: 'connecticut',
    de: 'delaware',
    dc: 'district of columbia',
    fl: 'florida',
    ga: 'georgia',
    hi: 'hawaii',
    id: 'idaho',
    il: 'illinois',
    in: 'indiana',
    ia: 'iowa',
    ks: 'kansas',
    ky: 'kentucky',
    la: 'louisiana',
    me: 'maine',
    md: 'maryland',
    ma: 'massachusetts',
    mi: 'michigan',
    mn: 'minnesota',
    ms: 'mississippi',
    mo: 'missouri',
    mt: 'montana',
    ne: 'nebraska',
    nv: 'nevada',
    nh: 'new hampshire',
    nj: 'new jersey',
    nm: 'new mexico',
    ny: 'new york',
    nc: 'north carolina',
    nd: 'north dakota',
    oh: 'ohio',
    ok: 'oklahoma',
    or: 'oregon',
    pa: 'pennsylvania',
    ri: 'rhode island',
    sc: 'south carolina',
    sd: 'south dakota',
    tn: 'tennessee',
    tx: 'texas',
    ut: 'utah',
    vt: 'vermont',
    va: 'virginia',
    wa: 'washington',
    wv: 'west virginia',
    wi: 'wisconsin',
    wy: 'wyoming',
    ab: 'alberta',
    bc: 'british columbia',
    mb: 'manitoba',
    nb: 'new brunswick',
    nl: 'newfoundland and labrador',
    ns: 'nova scotia',
    nt: 'northwest territories',
    nu: 'nunavut',
    on: 'ontario',
    pe: 'prince edward island',
    qc: 'quebec',
    sk: 'saskatchewan',
    yt: 'yukon',
  };

  var NAME_TO_ABBR = {};
  Object.keys(STATE_NAMES).forEach(function (abbr) {
    NAME_TO_ABBR[STATE_NAMES[abbr]] = abbr;
  });

  function canonicalState(raw) {
    var t = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, ' ');
    if (!t) return '';
    if (STATE_NAMES[t]) return t;
    if (NAME_TO_ABBR[t]) return NAME_TO_ABBR[t];
    return '';
  }

  function stateLabel(raw) {
    var code = canonicalState(raw);
    return code ? code.toUpperCase() : String(raw || '').trim();
  }

  function normalizePostal(raw) {
    var text = String(raw || '').trim().toUpperCase();
    if (!text) return '';
    var ca = text.match(/^([A-Z]\d[A-Z])\s*(\d[A-Z]\d)$/);
    if (ca) return ca[1] + ca[2];
    var us = text.match(/^(\d{5})(?:-\d{4})?$/);
    if (us) return us[1];
    return '';
  }

  function postalFromAddress(address, stateHint) {
    var addr = String(address || '');
    if (!addr) return '';
    var code = canonicalState(stateHint);
    if (code) {
      var anchored = new RegExp('\\b' + code + '\\s+(\\d{5})(?:-\\d{4})?\\b', 'i');
      var hit = addr.match(anchored);
      if (hit) return hit[1];
    }
    var afterAnyState = addr.match(
      /\b(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY]|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+(\d{5})(?:-\d{4})?\b/i,
    );
    if (afterAnyState) return afterAnyState[1];
    var zips = addr.match(/\b\d{5}(?:-\d{4})?\b/g);
    if (zips && zips.length) return zips[zips.length - 1].slice(0, 5);
    var ca = addr.match(/\b([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)\b/);
    if (ca) return (ca[1] + ca[2]).toUpperCase();
    return '';
  }

  function postalCodeOf(row) {
    var src = row && typeof row === 'object' ? row : {};
    var explicit = normalizePostal(
      src.postalCode || src.postal_code || src.zip || src.zipCode || '',
    );
    if (explicit) return explicit;
    return postalFromAddress(src.address, src.state);
  }

  function parseSearchQuery(raw) {
    var text = String(raw || '').trim();
    var empty = { city: '', state: '', zip: '', text: '' };
    if (!text) return empty;
    var postal = normalizePostal(text);
    if (postal) return { city: '', state: '', zip: postal, text: '' };
    var soloState = canonicalState(text);
    var soloKey = text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    if (soloState && (soloKey.length === 2 || NAME_TO_ABBR[soloKey] === soloState)) {
      return { city: '', state: soloState, zip: '', text: '' };
    }
    var comma = text.match(/^([^,]+),\s*([A-Za-z][A-Za-z .'-]{1,30})$/);
    if (comma) {
      var commaState = canonicalState(comma[2]);
      if (commaState) {
        return { city: comma[1].trim(), state: commaState, zip: '', text: '' };
      }
    }
    var parts = text.split(/\s+/);
    if (parts.length >= 2 && parts.length <= 4) {
      var tail = canonicalState(parts[parts.length - 1]);
      if (tail) {
        return {
          city: parts.slice(0, -1).join(' '),
          state: tail,
          zip: '',
          text: '',
        };
      }
    }
    return { city: '', state: '', zip: '', text: text };
  }

  function cityMatches(row, wantRaw) {
    var want = String(wantRaw || '').trim().toLowerCase();
    if (!want) return true;
    var city = String((row && row.city) || '').trim().toLowerCase();
    if (city) return city === want || city.indexOf(want) === 0;
    var addr = String((row && row.address) || '').toLowerCase();
    return addr.indexOf(want) !== -1;
  }

  function stateMatches(row, wantRaw) {
    var want = String(wantRaw || '').trim();
    if (!want) return true;
    var wantCode = canonicalState(want);
    var haveCode = canonicalState(row && row.state);
    if (!haveCode) haveCode = canonicalState(stateFromAddress(row && row.address));
    if (wantCode && haveCode) return wantCode === haveCode;
    var have = String((row && row.state) || '').trim().toLowerCase();
    var needle = want.toLowerCase();
    return have === needle || have.indexOf(needle) === 0;
  }

  function stateFromAddress(address) {
    var addr = String(address || '');
    var match = addr.match(/,\s*([A-Za-z]{2})\s+\d{5}\b/);
    if (match && canonicalState(match[1])) return match[1];
    var loose = addr.match(/,\s*([A-Za-z]{2})\s*$/);
    if (loose && canonicalState(loose[1])) return loose[1];
    return '';
  }

  function zipMatches(row, wantRaw) {
    var want = normalizePostal(wantRaw);
    if (!want) {
      var digits = String(wantRaw || '').replace(/\D/g, '');
      if (digits.length >= 3 && digits.length < 5) {
        return postalCodeOf(row).indexOf(digits) === 0;
      }
      var partial = String(wantRaw || '').trim().toUpperCase().replace(/\s+/g, '');
      if (partial.length >= 3) return postalCodeOf(row).indexOf(partial) === 0;
      return !String(wantRaw || '').trim();
    }
    return postalCodeOf(row) === want || postalCodeOf(row).indexOf(want) === 0;
  }

  function haystack(row) {
    var src = row && typeof row === 'object' ? row : {};
    var state = canonicalState(src.state);
    var bits = [
      src.name,
      src.category,
      src.city,
      src.state,
      state ? STATE_NAMES[state] : '',
      src.address,
      postalCodeOf(src),
      src.phone,
      src.slug,
      src.licenseNumber,
    ];
    return bits
      .map(function (part) {
        return String(part || '').toLowerCase();
      })
      .join(' ');
  }

  function matchesListing(row, filters) {
    var src = row && typeof row === 'object' ? row : {};
    var opts = filters && typeof filters === 'object' ? filters : {};
    var parsed = parseSearchQuery(opts.q);
    var city = String(opts.city || '').trim() || parsed.city;
    var state = String(opts.state || '').trim() || parsed.state;
    var zip = String(opts.zip || '').trim() || parsed.zip;
    var status = String(opts.status || '').trim().toLowerCase();
    if (status === 'published' && src.published !== true) return false;
    if (status === 'draft' && src.published === true) return false;
    if (!cityMatches(src, city)) return false;
    if (!stateMatches(src, state)) return false;
    if (zip && !zipMatches(src, zip)) return false;
    var text = String(parsed.text || '').trim().toLowerCase();
    if (!text) return true;
    var blob = haystack(src);
    var tokens = text.split(/\s+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i += 1) {
      if (blob.indexOf(tokens[i]) === -1) return false;
    }
    return true;
  }

  function filterListings(rows, filters) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return matchesListing(row, filters);
    });
  }

  function placeLabel(row) {
    var city = String((row && row.city) || '').trim();
    var state = stateLabel(row && row.state);
    if (city && state) return city + ', ' + state;
    return city || state || '';
  }

  return {
    STATE_NAMES: STATE_NAMES,
    canonicalState: canonicalState,
    stateLabel: stateLabel,
    normalizePostal: normalizePostal,
    postalCodeOf: postalCodeOf,
    parseSearchQuery: parseSearchQuery,
    matchesListing: matchesListing,
    filterListings: filterListings,
    placeLabel: placeLabel,
  };
});
