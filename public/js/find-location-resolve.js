/**
 * Find Leads area-step location parse + geocode timeout policy.
 * Typed "City, ST" is enough to proceed; Google geocode is best-effort.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdhelloFindLocation = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var GEOCODE_TIMEOUT_MS = 10000;

  function parseCityStateFromQuery(raw) {
    var q = String(raw || '').trim();
    if (!q) return { city: '', state: '' };
    var parts = q.split(',').map(function (s) {
      return s.trim();
    }).filter(Boolean);
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var stMatch = last.match(/^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
      if (stMatch) {
        return {
          city: parts[parts.length - 2] || parts[0] || '',
          state: stMatch[1].toUpperCase(),
        };
      }
      var zipMatch = last.match(/([A-Za-z]{2})\s+(\d{5})/);
      if (zipMatch && parts.length >= 3) {
        return { city: parts[parts.length - 2] || '', state: zipMatch[1].toUpperCase() };
      }
    }
    if (parts.length === 1) {
      var spaced = parts[0].match(/^(.*)\s+([A-Za-z]{2})$/);
      if (spaced && spaced[1].trim()) {
        return { city: spaced[1].trim(), state: spaced[2].toUpperCase() };
      }
      return { city: parts[0], state: '' };
    }
    return { city: parts[0] || '', state: '' };
  }

  function locationLabel(city, state, fallback) {
    var c = String(city || '').trim();
    var s = String(state || '').trim().toUpperCase();
    if (c && s) return c + ', ' + s;
    if (c) return c;
    return String(fallback || '').trim();
  }

  /**
   * Prefer a complete geocode result; otherwise accept typed City, ST.
   * Timed-out geocode must still unlock the keyword step when the query parses.
   */
  function pickResolvedLocation(query, geocodeLoc, opts) {
    opts = opts || {};
    var q = String(query || '').trim();
    var parsed = parseCityStateFromQuery(q);
    if (geocodeLoc && geocodeLoc.city && geocodeLoc.state) {
      return {
        ok: true,
        city: String(geocodeLoc.city).trim(),
        state: String(geocodeLoc.state).trim().slice(0, 2).toUpperCase(),
        label: String(geocodeLoc.label || q || '').trim() || locationLabel(geocodeLoc.city, geocodeLoc.state, q),
        source: 'geocode',
      };
    }
    if (geocodeLoc && geocodeLoc.city && parsed.state) {
      return {
        ok: true,
        city: String(geocodeLoc.city).trim(),
        state: parsed.state,
        label: String(geocodeLoc.label || q || '').trim() || locationLabel(geocodeLoc.city, parsed.state, q),
        source: 'geocode+typed',
      };
    }
    if (parsed.city && parsed.state) {
      return {
        ok: true,
        city: parsed.city,
        state: parsed.state,
        label: q || locationLabel(parsed.city, parsed.state, ''),
        source: opts.timedOut ? 'typed-timeout' : 'typed',
      };
    }
    if (parsed.city) {
      if (opts.timedOut) {
        return {
          ok: false,
          city: parsed.city,
          state: '',
          error: 'Location lookup timed out. Try City, ST (e.g. Vancouver, WA).',
        };
      }
      return {
        ok: false,
        city: parsed.city,
        state: '',
        error: 'Add a state — e.g. Vancouver, WA',
      };
    }
    if (!q) {
      return { ok: false, city: '', state: '', error: 'Enter a city, state, or address.' };
    }
    return {
      ok: false,
      city: '',
      state: '',
      error: opts.timedOut
        ? 'Location lookup timed out. Try City, ST (e.g. Vancouver, WA).'
        : 'Could not find that location — try City, ST (e.g. Vancouver, WA).',
    };
  }

  function statusMessageForLocation(picked) {
    if (!picked) return 'Enter a location above to continue.';
    if (picked.ok) {
      var label = locationLabel(picked.city, picked.state, picked.label);
      if (picked.source === 'typed-timeout') return 'Using ' + label + ' — lookup timed out.';
      return "We'll search in " + label + '.';
    }
    return picked.error || 'Enter a location above to continue.';
  }

  /**
   * Run a callback-style geocode with a hard timeout. Always calls done once.
   * geocodeFn(query, cb) should invoke cb(loc, err). If it never does, we time out.
   */
  function geocodeWithTimeout(geocodeFn, query, timeoutMs, done) {
    var finished = false;
    var ms = Math.max(1, Number(timeoutMs) || GEOCODE_TIMEOUT_MS);
    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      done({ timedOut: true, loc: null, error: null });
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();

    function finish(payload) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(payload);
    }

    if (typeof geocodeFn !== 'function') {
      finish({ timedOut: false, loc: null, error: 'no_geocoder' });
      return;
    }
    try {
      geocodeFn(query, function (loc, err) {
        finish({ timedOut: false, loc: loc || null, error: err || null });
      });
    } catch (e) {
      finish({ timedOut: false, loc: null, error: e });
    }
  }

  function resolveQueryWithGeocode(query, geocodeFn, timeoutMs, done) {
    geocodeWithTimeout(geocodeFn, query, timeoutMs, function (result) {
      var picked = pickResolvedLocation(query, result.loc, { timedOut: result.timedOut });
      done({
        timedOut: !!result.timedOut,
        picked: picked,
        geocodeError: result.error || null,
      });
    });
  }

  return {
    GEOCODE_TIMEOUT_MS: GEOCODE_TIMEOUT_MS,
    parseCityStateFromQuery: parseCityStateFromQuery,
    pickResolvedLocation: pickResolvedLocation,
    statusMessageForLocation: statusMessageForLocation,
    geocodeWithTimeout: geocodeWithTimeout,
    resolveQueryWithGeocode: resolveQueryWithGeocode,
    locationLabel: locationLabel,
  };
});
