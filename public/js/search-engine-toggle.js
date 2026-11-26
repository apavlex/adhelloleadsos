/**
 * Top-bar switch: Treg for search, chat, and the chatbot, or the built-in providers.
 */
(function () {
  var roots = document.querySelectorAll('[data-search-engine-root]');
  if (!roots.length) return;

  var mode = roots[0].getAttribute('data-mode') === 'treg' ? 'treg' : 'default';
  var ready = roots[0].getAttribute('data-ready') === '1';
  var panel = document.getElementById('searchEnginePanel');
  var btn = document.getElementById('searchEngineBtn');
  var saving = false;

  function notes() {
    return document.querySelectorAll('.search-engine-note');
  }

  function setNote(text) {
    notes().forEach(function (el) {
      el.textContent = text;
    });
  }

  function defaultNote() {
    if (!ready) {
      return 'Treg needs a TREG_TOKEN on the server before it can run searches.';
    }
    if (mode === 'treg') {
      return 'Search, chat, and the chatbot use the Treg catalog. Directories, marketplaces, permits, and SEO stay on the built-in providers.';
    }
    return 'Every search uses the built-in providers.';
  }

  function paint(next) {
    mode = next === 'treg' ? 'treg' : 'default';
    roots.forEach(function (el) {
      el.setAttribute('data-mode', mode);
      el.classList.toggle('is-treg', mode === 'treg');
    });
    document.querySelectorAll('[data-search-engine]').forEach(function (el) {
      var on = el.getAttribute('data-search-engine') === mode;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      el.classList.toggle('is-on', on);
    });
    var label = document.getElementById('searchEngineLabel');
    if (label) label.textContent = mode === 'treg' ? 'Treg' : 'Default';
    setNote(defaultNote());
  }

  function setOpen(open) {
    if (!panel || !btn) return;
    panel.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function spendLine(last) {
    if (!last || !last.costMicro) return '';
    var dollars = Number(last.costMicro) / 1000000;
    if (!isFinite(dollars) || dollars <= 0) return '';
    return ' Last Treg call $' + dollars.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '.';
  }

  async function refreshNote() {
    try {
      var res = await fetch('/api/search-engine', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      var data = await res.json();
      if (data && typeof data.ready === 'boolean') ready = data.ready;
      if (data && (data.mode === 'treg' || data.mode === 'default') && data.mode !== mode) {
        paint(data.mode);
      } else {
        setNote(defaultNote() + spendLine(data && data.last));
      }
    } catch (_) {
      /* keep the local label */
    }
  }

  async function choose(next) {
    if (saving || next === mode) {
      setOpen(false);
      return;
    }
    var previous = mode;
    saving = true;
    paint(next);
    setOpen(false);
    try {
      var res = await fetch('/api/search-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.success) {
        paint(previous);
        setNote((data && data.error) || 'Could not save the search engine.');
        return;
      }
      if (typeof data.ready === 'boolean') ready = data.ready;
      paint(data.mode || next);
      setNote(defaultNote() + spendLine(data.last));
    } catch (_) {
      paint(previous);
      setNote('Could not save the search engine.');
    } finally {
      saving = false;
    }
  }

  paint(mode);

  if (btn) {
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = panel && panel.classList.contains('hidden');
      setOpen(!!open);
      if (open) refreshNote();
    });
  }

  document.querySelectorAll('[data-search-engine]').forEach(function (el) {
    el.addEventListener('click', function () {
      choose(el.getAttribute('data-search-engine'));
    });
  });

  document.addEventListener('click', function (event) {
    if (!panel || panel.classList.contains('hidden')) return;
    if (btn && btn.contains(event.target)) return;
    if (panel.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setOpen(false);
  });
})();
