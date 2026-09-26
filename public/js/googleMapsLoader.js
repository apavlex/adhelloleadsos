/**
 * Map helpers — OpenStreetMap embeds by default (free, no API key).
 * Google Maps JS loader kept for Find Leads interactive map when a key exists.
 */
(function (global) {
  var loading = false;
  var queue = [];

  function drain(err) {
    var q = queue.slice();
    queue = [];
    loading = false;
    q.forEach(function (fn) {
      try {
        fn(err || null);
      } catch (e) {
        console.warn('[AdhelloMaps]', e);
      }
    });
  }

  function mapsScriptUrl(key) {
    return (
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(key) +
      '&v=weekly&callback=__adhelloMapsBoot'
    );
  }

  function load(key, cb) {
    if (typeof cb !== 'function') return;
    key = String(key || '').trim();
    if (!key) {
      cb(new Error('no_key'));
      return;
    }
    if (global.google && global.google.maps) {
      cb(null);
      return;
    }
    queue.push(cb);
    if (loading) return;
    loading = true;

    var existing = document.querySelector('script[data-adhello-maps-loader]');
    if (existing) return;

    global.__adhelloMapsBoot = function adhelloMapsBoot() {
      try {
        delete global.__adhelloMapsBoot;
      } catch (_) {
        global.__adhelloMapsBoot = undefined;
      }
      drain(null);
    };

    global.gm_authFailure = function gmAuthFailure() {
      console.warn(
        '[AdhelloMaps] Google Maps authentication failed — check API key, billing, and HTTP referrer restrictions.',
      );
      drain(new Error('auth_failure'));
    };

    var s = document.createElement('script');
    s.async = true;
    s.defer = true;
    s.setAttribute('data-adhello-maps-loader', '1');
    s.onerror = function () {
      drain(new Error('script_failed'));
    };
    s.src = mapsScriptUrl(key);
    document.head.appendChild(s);
  }

  function parseLatLng(query) {
    var m = String(query || '')
      .trim()
      .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var lat = parseFloat(m[1]);
    var lng = parseFloat(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  /** Free OpenStreetMap embed — no API key. */
  function osmEmbedSrc(lat, lng, zoom) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    var z = Math.min(18, Math.max(12, parseInt(zoom, 10) || 15));
    var delta = z >= 16 ? 0.006 : z >= 15 ? 0.01 : 0.018;
    var bbox = lng - delta + ',' + (lat - delta) + ',' + (lng + delta) + ',' + (lat + delta);
    return (
      'https://www.openstreetmap.org/export/embed.html?bbox=' +
      encodeURIComponent(bbox) +
      '&layer=mapnik&marker=' +
      encodeURIComponent(lat + ',' + lng)
    );
  }

  /**
   * Embed URL for a place.
   * Prefer OSM when lat/lng are known. Address-only callers should use
   * /leads/map-location.json (or pass lat,lng) — Google Embed is not used.
   */
  function embedSrc(query, _key, lat, lng) {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return osmEmbedSrc(lat, lng);
    }
    var pair = parseLatLng(query);
    if (pair) return osmEmbedSrc(pair.lat, pair.lng);
    return '';
  }

  function locationJsonUrl(opts) {
    var o = opts || {};
    var params = new URLSearchParams();
    if (o.q || o.center) params.set('q', String(o.q || o.center || '').trim());
    if (Number.isFinite(o.lat)) params.set('lat', String(o.lat));
    if (Number.isFinite(o.lng)) params.set('lng', String(o.lng));
    return '/leads/map-location.json?' + params.toString();
  }

  /**
   * Resolve a free OSM embed URL for an address or coordinates.
   * @returns {Promise<{embedUrl:string, openUrl:string, lat:number, lng:number}|null>}
   */
  function resolveEmbed(opts) {
    var o = opts || {};
    if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      return Promise.resolve({
        embedUrl: osmEmbedSrc(o.lat, o.lng),
        openUrl:
          'https://www.openstreetmap.org/?mlat=' +
          encodeURIComponent(o.lat) +
          '&mlon=' +
          encodeURIComponent(o.lng) +
          '#map=16/' +
          encodeURIComponent(o.lat) +
          '/' +
          encodeURIComponent(o.lng),
        lat: o.lat,
        lng: o.lng,
      });
    }
    var pair = parseLatLng(o.q || o.center || '');
    if (pair) {
      return resolveEmbed({ lat: pair.lat, lng: pair.lng });
    }
    var q = String(o.q || o.center || '').trim();
    if (!q) return Promise.resolve(null);
    return fetch(locationJsonUrl({ q: q }), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data || {} };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.success || !result.data.embedUrl) return null;
        return {
          embedUrl: String(result.data.embedUrl),
          openUrl: String(result.data.openUrl || ''),
          lat: Number(result.data.lat),
          lng: Number(result.data.lng),
        };
      })
      .catch(function () {
        return null;
      });
  }

  global.AdhelloMaps = {
    load: load,
    embedSrc: embedSrc,
    osmEmbedSrc: osmEmbedSrc,
    resolveEmbed: resolveEmbed,
  };
})(typeof window !== 'undefined' ? window : globalThis);
