/* Member referral app: Add-to-Home-Screen hint, copy and share buttons. */
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var hint = document.getElementById('maInstall');
  var KEY = 'ma-install-hint-dismissed';

  function dismissed() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  if (hint && isIOS && !standalone && !dismissed()) {
    hint.hidden = false;
  }
  document.addEventListener('click', function (event) {
    var close = event.target.closest('[data-ma-install-close]');
    if (close && hint) {
      hint.hidden = true;
      try { localStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ }
      return;
    }

    var copyBtn = event.target.closest('[data-ma-copy]');
    if (copyBtn) {
      var text = copyBtn.getAttribute('data-ma-copy');
      var done = function () {
        var original = copyBtn.innerHTML;
        copyBtn.textContent = 'Copied';
        setTimeout(function () { copyBtn.innerHTML = original; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { window.prompt('Copy this link:', text); });
      } else {
        window.prompt('Copy this link:', text);
      }
      return;
    }

    var shareBtn = event.target.closest('[data-ma-share]');
    if (shareBtn) {
      var url = shareBtn.getAttribute('data-ma-share');
      var title = shareBtn.getAttribute('data-ma-share-title') || document.title;
      if (navigator.share) {
        navigator.share({ title: title, text: title + ':', url: url }).catch(function () { /* cancelled */ });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          var original = shareBtn.innerHTML;
          shareBtn.textContent = 'Link copied';
          setTimeout(function () { shareBtn.innerHTML = original; }, 1600);
        });
      } else {
        window.prompt('Copy this link:', url);
      }
    }
  });
})();
