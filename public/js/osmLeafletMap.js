/**
 * Free Leaflet + OpenStreetMap map (no API key, no WebGL).
 * Used by Money Mode and lead panel when Google Maps Embed is unavailable.
 */
(function (global) {
  var leafletPromise = null;
  var LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  var LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

  function loadLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.querySelector('link[data-adhello-leaflet]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS;
        link.setAttribute('data-adhello-leaflet', '1');
        document.head.appendChild(link);
      }
      if (global.L && global.L.map) {
        resolve(global.L);
        return;
      }
      var existing = document.querySelector('script[data-adhello-leaflet]');
      if (existing) {
        existing.addEventListener('load', function () {
          if (global.L) resolve(global.L);
          else reject(new Error('leaflet_missing'));
        });
        existing.addEventListener('error', function () {
          reject(new Error('leaflet_script'));
        });
        return;
      }
      var s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.async = true;
      s.setAttribute('data-adhello-leaflet', '1');
      s.onload = function () {
        if (global.L) resolve(global.L);
        else reject(new Error('leaflet_missing'));
      };
      s.onerror = function () {
        reject(new Error('leaflet_script'));
      };
      document.head.appendChild(s);
    });
    return leafletPromise;
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

  function resolveCoords(opts) {
    var o = opts || {};
    if (Number.isFinite(o.lat) && Number.isFinite(o.lng)) {
      return Promise.resolve({ lat: o.lat, lng: o.lng });
    }
    var pair = parseLatLng(o.q || o.center || '');
    if (pair) return Promise.resolve(pair);
    var q = String(o.q || o.center || '').trim();
    if (!q) return Promise.resolve(null);
    if (global.AdhelloMaps && typeof global.AdhelloMaps.resolveEmbed === 'function') {
      return global.AdhelloMaps.resolveEmbed({ q: q }).then(function (loc) {
        if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
          return { lat: loc.lat, lng: loc.lng };
        }
        return null;
      });
    }
    var params = new URLSearchParams();
    params.set('q', q);
    return fetch('/leads/map-location.json?' + params.toString(), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data || {} };
        });
      })
      .then(function (result) {
        if (!result.ok || !result.data.success) return null;
        var lat = Number(result.data.lat);
        var lng = Number(result.data.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat: lat, lng: lng };
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Mount an OSM map into containerEl.
   * @returns {Promise<{map: object, openUrl: string}|null>}
   */
  function mount(containerEl, opts) {
    if (!containerEl) return Promise.resolve(null);
    var o = opts || {};
    return Promise.all([loadLeaflet(), resolveCoords(o)]).then(function (parts) {
      var L = parts[0];
      var coords = parts[1];
      if (!L || !coords) return null;

      // Tear down previous instance on this node
      if (containerEl._adhelloLeaflet) {
        try {
          containerEl._adhelloLeaflet.remove();
        } catch (_) {}
        containerEl._adhelloLeaflet = null;
      }
      containerEl.innerHTML = '';
      containerEl.classList.remove('hidden');
      containerEl._adhelloTileFallback = false;

      var map = L.map(containerEl, {
        zoomControl: false,
        attributionControl: true,
        dragging: true,
        scrollWheelZoom: false,
      }).setView([coords.lat, coords.lng], o.zoom || 15);

      // No Carto — free basemaps now require an API key and return watermarked tiles
      // (200 OK, so tileerror never fires). Esri + OSM.fr are key-free.
      var tileProviders = [
        {
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          opts: {
            maxZoom: 19,
            attribution:
              'Tiles &copy; Esri &mdash; Source: Esri, OpenStreetMap',
          },
        },
        {
          url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
          opts: {
            maxZoom: 20,
            subdomains: 'abc',
            attribution:
              '&copy; <a href="https://www.openstreetmap.fr">OpenStreetMap France</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
      ];
      var providerIndex = 0;
      function addProvider(index) {
        if (index >= tileProviders.length) return null;
        var spec = tileProviders[index];
        var layer = L.tileLayer(spec.url, spec.opts);
        layer.on('tileerror', function () {
          if (containerEl._adhelloTileFallback) return;
          containerEl._adhelloTileFallback = true;
          try {
            map.removeLayer(layer);
          } catch (_) {}
          containerEl._adhelloTileFallback = false;
          var next = addProvider(index + 1);
          if (next) next.addTo(map);
        });
        return layer;
      }
      var tile = addProvider(providerIndex);
      if (tile) tile.addTo(map);

      L.marker([coords.lat, coords.lng]).addTo(map);

      // Leaflet needs a layout pass when the container was recently shown
      setTimeout(function () {
        try {
          map.invalidateSize();
        } catch (_) {}
      }, 80);
      setTimeout(function () {
        try {
          map.invalidateSize();
        } catch (_) {}
      }, 300);

      containerEl._adhelloLeaflet = map;
      return {
        map: map,
        lat: coords.lat,
        lng: coords.lng,
        openUrl:
          'https://www.openstreetmap.org/?mlat=' +
          encodeURIComponent(coords.lat) +
          '&mlon=' +
          encodeURIComponent(coords.lng) +
          '#map=16/' +
          encodeURIComponent(coords.lat) +
          '/' +
          encodeURIComponent(coords.lng),
      };
    });
  }

  function destroy(containerEl) {
    if (!containerEl) return;
    if (containerEl._adhelloLeaflet) {
      try {
        containerEl._adhelloLeaflet.remove();
      } catch (_) {}
      containerEl._adhelloLeaflet = null;
    }
    containerEl.innerHTML = '';
  }

  global.AdhelloOsmMap = {
    loadLeaflet: loadLeaflet,
    resolveCoords: resolveCoords,
    mount: mount,
    destroy: destroy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
