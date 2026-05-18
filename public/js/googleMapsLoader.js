/**
 * Shared Google Maps JS loader + embed URL helper.
 * Surfaces auth failures via gm_authFailure instead of a blank gray tile.
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
      '&v=weekly&loading=async&callback=__adhelloMapsBoot'
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
      console.warn('[AdhelloMaps] Google Maps authentication failed — check API key, billing, and HTTP referrer restrictions.');
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

  function embedSrc(query, key) {
    var q = String(query || '').trim();
    if (!q) return '';
    var k = String(key || '').trim();
    if (k) {
      return (
        'https://www.google.com/maps/embed/v1/place?key=' +
        encodeURIComponent(k) +
        '&q=' +
        encodeURIComponent(q) +
        '&zoom=15&maptype=roadmap'
      );
    }
    return (
      'https://www.google.com/maps?q=' +
      encodeURIComponent(q) +
      '&hl=en&z=15&output=embed'
    );
  }

  global.AdhelloMaps = {
    load: load,
    embedSrc: embedSrc,
  };
})(typeof window !== 'undefined' ? window : globalThis);
