/**
 * Browser build of services/socialUrlNormalize.js — keep logic in sync.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AdhelloSocialUrlNormalize = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var PLATFORM_HOSTS = {
    facebook: ['facebook.com', 'fb.com', 'fb.me', 'm.facebook.com'],
    instagram: ['instagram.com', 'instagr.am'],
    twitter: ['twitter.com', 'x.com'],
    linkedin: ['linkedin.com'],
    tiktok: ['tiktok.com'],
  };

  var PLATFORM_BASE = {
    facebook: function (handle) {
      return 'https://www.facebook.com/' + handle;
    },
    instagram: function (handle) {
      return 'https://www.instagram.com/' + handle.replace(/^@/, '') + '/';
    },
    twitter: function (handle) {
      return 'https://x.com/' + handle.replace(/^@/, '');
    },
    linkedin: function (handle) {
      var h = handle.replace(/^@/, '').replace(/\/$/, '');
      if (/^company\//i.test(h) || /^in\//i.test(h)) {
        return 'https://www.linkedin.com/' + h;
      }
      return 'https://www.linkedin.com/company/' + h;
    },
    tiktok: function (handle) {
      return 'https://www.tiktok.com/@' + handle.replace(/^@/, '');
    },
  };

  function isPlaceholder(v) {
    var s = String(v == null ? '' : v).trim();
    return !s || s === 'N/A' || s === 'undefined' || s === 'null' || s === '—' || s === '-';
  }

  function looksLikeLocationNotUrl(s) {
    if (/^https?:\/\//i.test(s)) return false;
    if (/[@]|\.(com|org|net|io|co)\b|facebook|instagram|twitter|linkedin|tiktok/i.test(s)) {
      return false;
    }
    if (/^[,.\s\-_]+$/.test(s)) return true;
    if (/^,?\s*[A-Za-z]{2,3}\s*$/.test(s)) return true;
    if (/^[A-Za-z\s.'-]+,\s*[A-Za-z]{2,}(\s+\d{5})?$/.test(s)) return true;
    return false;
  }

  function hostMatchesPlatform(host, platform) {
    var allowed = PLATFORM_HOSTS[platform];
    if (!allowed) return true;
    var h = String(host || '')
      .replace(/^www\./, '')
      .toLowerCase();
    return allowed.some(function (d) {
      return h === d || h.endsWith('.' + d);
    });
  }

  function isUsableHostname(host) {
    var h = String(host || '').trim();
    if (!h || h === ',' || h === '.' || h.length < 3) return false;
    if (h.indexOf('.') === -1) return false;
    if (!/^[a-z0-9.-]+$/i.test(h)) return false;
    return true;
  }

  function finalizeSocialUrl(url, platform) {
    try {
      var u = new URL(url);
      var host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (!isUsableHostname(host)) return '';
      if (platform && !hostMatchesPlatform(host, platform)) return '';
      return u.href;
    } catch (_) {
      return '';
    }
  }

  function normalizePlainHandle(handle, platform) {
    var h = String(handle || '')
      .trim()
      .replace(/^@/, '')
      .replace(/\/$/, '');
    if (!h || !/^[\w.-]+$/.test(h) || h.length < 3) return '';
    var build = PLATFORM_BASE[platform];
    if (!build) return '';
    return finalizeSocialUrl(build(h), platform);
  }

  function normalizeSocialUrl(raw, platform) {
    if (isPlaceholder(raw)) return '';
    var s = String(raw).trim();

    if (looksLikeLocationNotUrl(s)) return '';

    if (s.indexOf(',') !== -1 && !/^https?:\/\/[^,?#]+/i.test(s)) {
      var parts = s
        .split(',')
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean);
      for (var i = 0; i < parts.length; i += 1) {
        var normalized = normalizeSocialUrl(parts[i], platform);
        if (normalized) return normalized;
      }
      return '';
    }

    if (/^@[\w.-]+$/.test(s)) {
      return normalizePlainHandle(s, platform);
    }

    if (!/^https?:\/\//i.test(s)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(s) || s.indexOf('/') !== -1) {
        s = 'https://' + s.replace(/^\/\//, '');
      } else if (/^[\w.-]+$/.test(s)) {
        return normalizePlainHandle(s, platform);
      } else {
        return '';
      }
    }

    return finalizeSocialUrl(s, platform);
  }

  return {
    PLATFORM_HOSTS: PLATFORM_HOSTS,
    isPlaceholder: isPlaceholder,
    normalizeSocialUrl: normalizeSocialUrl,
  };
});
