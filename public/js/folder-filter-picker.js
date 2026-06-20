(function () {
  function initFolderFilterPickers() {
    document.querySelectorAll('[data-folder-picker]').forEach(function (root) {
      if (root.getAttribute('data-folder-picker-bound') === '1') return;
      root.setAttribute('data-folder-picker-bound', '1');

      var hidden = root.querySelector('[data-folder-picker-value]');
      var trigger = root.querySelector('.folder-filter-picker-trigger');
      var panel = root.querySelector('.folder-filter-picker-panel');
      var search = root.querySelector('.folder-filter-picker-search');
      var labelEl = root.querySelector('.folder-filter-picker-label');
      var emptyMsg = root.querySelector('.folder-filter-picker-empty');
      var options = root.querySelectorAll('.folder-filter-picker-option');

      if (!hidden || !trigger || !panel || !labelEl) return;

      function setOpen(open) {
        panel.classList.toggle('hidden', !open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && search) {
          search.value = '';
          applySearch('');
          search.focus();
        }
      }

      function applySearch(query) {
        var q = String(query || '').trim().toLowerCase();
        var visible = 0;
        options.forEach(function (opt) {
          var hay = String(opt.getAttribute('data-search') || opt.textContent || '').toLowerCase();
          var match = !q || hay.indexOf(q) >= 0;
          opt.classList.toggle('hidden', !match);
          if (match) visible += 1;
        });
        root.querySelectorAll('[data-folder-picker-group]').forEach(function (grp) {
          var any = grp.querySelector('.folder-filter-picker-option:not(.hidden)');
          grp.classList.toggle('hidden', !any);
        });
        if (emptyMsg) emptyMsg.classList.toggle('hidden', visible > 0);
      }

      function selectOption(opt) {
        var key = opt.getAttribute('data-key') || '';
        var label = opt.getAttribute('data-label') || opt.textContent.trim();
        hidden.value = key;
        labelEl.textContent = label;
        options.forEach(function (item) {
          item.classList.toggle('bg-brand-yellow/15', item === opt);
          item.classList.toggle('dark:bg-brand-yellow/10', item === opt);
        });
        setOpen(false);
      }

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(panel.classList.contains('hidden'));
      });

      if (search) {
        search.addEventListener('input', function () {
          applySearch(search.value);
        });
        search.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        });
      }

      options.forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.preventDefault();
          selectOption(opt);
        });
      });

      document.addEventListener('click', function (e) {
        if (!root.contains(e.target)) setOpen(false);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFolderFilterPickers);
  } else {
    initFolderFilterPickers();
  }
})();
