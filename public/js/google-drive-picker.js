(function (global) {
  'use strict';

  var config = null;

  function setConfig(next) {
    config = next && typeof next === 'object' ? next : {};
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function ensurePicker(cb) {
    if (global.google && global.google.picker) return cb();
    if (global.gapi && global.gapi.load) {
      global.gapi.load('picker', function () {
        cb();
      });
      return;
    }
    loadScript('https://apis.google.com/js/api.js')
      .then(function () {
        global.gapi.load('picker', function () {
          cb();
        });
      })
      .catch(function () {
        throw new Error('Could not load Google Picker.');
      });
  }

  function fetchAccessToken() {
    return fetch('/leads/google-drive/access-token', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (res) {
        return res.json().then(function (j) {
          return { ok: res.ok, j: j };
        });
      })
      .then(function (pack) {
        if (!pack.ok || !pack.j || !pack.j.success || !pack.j.accessToken) {
          throw new Error((pack.j && pack.j.error) || 'Connect Google Drive first.');
        }
        return pack.j.accessToken;
      });
  }

  /**
   * @param {{ title?: string, mimeTypes?: string, viewId?: string }} opts
   * @returns {Promise<{ fileId: string, name: string }|null>}
   */
  function open(opts) {
    opts = opts || {};
    var cfg = config || {};
    if (!cfg.developerKey) {
      return Promise.reject(new Error('Google Picker is not configured on the server.'));
    }
    if (!cfg.appId) {
      return Promise.reject(new Error('Google OAuth client ID is not configured.'));
    }

    var mimeTypes =
      opts.mimeTypes ||
      'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp,image/tiff';
    var title = opts.title || 'Select a file from Google Drive';

    return fetchAccessToken().then(function (oauthToken) {
      return new Promise(function (resolve, reject) {
        ensurePicker(function () {
          try {
            var imagesView = new global.google.picker.DocsView(
              opts.viewId || global.google.picker.ViewId.DOCS_IMAGES,
            )
              .setIncludeFolders(true)
              .setMimeTypes(mimeTypes);
            var picker = new global.google.picker.PickerBuilder()
              .setOAuthToken(oauthToken)
              .setDeveloperKey(cfg.developerKey)
              .setAppId(cfg.appId)
              .addView(imagesView)
              .addView(new global.google.picker.DocsUploadView())
              .setTitle(title)
              .setCallback(function (data) {
                var action = data[global.google.picker.Response.ACTION];
                if (action === global.google.picker.Action.CANCEL) {
                  resolve(null);
                  return;
                }
                if (action !== global.google.picker.Action.PICKED) return;
                var docs = data[global.google.picker.Response.DOCUMENTS];
                var doc = docs && docs[0];
                var fileId = doc && doc[global.google.picker.Document.ID];
                if (!fileId) {
                  resolve(null);
                  return;
                }
                resolve({
                  fileId: fileId,
                  name: (doc && doc[global.google.picker.Document.NAME]) || '',
                });
              })
              .build();
            picker.setVisible(true);
          } catch (err) {
            reject(err);
          }
        });
      });
    });
  }

  global.AdHelloDrivePicker = {
    setConfig: setConfig,
    open: open,
  };
})(window);
