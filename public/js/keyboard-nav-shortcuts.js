(function () {
  function typingTarget(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var t = el.type;
      if (t === 'button' || t === 'submit' || t === 'checkbox' || t === 'radio' || t === 'file') return false;
      return true;
    }
    return el.isContentEditable;
  }
  var armed = false;
  var timer = null;
  document.addEventListener(
    'keydown',
    function (e) {
      if (typingTarget(document.activeElement)) return;
      var k = e.key;
      if (armed) {
        armed = false;
        if (timer) clearTimeout(timer);
        timer = null;
        if (k === 'f' || k === 'F') {
          e.preventDefault();
          var focusUrl = '/focus';
          try {
            var raw = sessionStorage.getItem('adhello_focus_selected_keys');
            if (raw) {
              var keys = JSON.parse(raw);
              if (Array.isArray(keys) && keys.length) {
                focusUrl =
                  '/focus?lead=' +
                  encodeURIComponent(String(keys[0])) +
                  '&keys=' +
                  encodeURIComponent(keys.join(','));
              }
            }
          } catch (_) {}
          window.location.href = focusUrl;
          return;
        }
        if (k === 't' || k === 'T') {
          e.preventDefault();
          window.location.href = '/today';
          return;
        }
      }
      if (k === 'g' || k === 'G') {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        armed = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          armed = false;
          timer = null;
        }, 900);
      }
    },
    true,
  );
})();
