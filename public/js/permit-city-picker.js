(function () {
  function initPermitCityPickers() {
    document.querySelectorAll('[data-permit-city-picker]').forEach(function (root) {
      if (root.getAttribute('data-permit-city-picker-bound') === '1') return;
      root.setAttribute('data-permit-city-picker-bound', '1');

      var hidden = root.querySelector('[data-permit-city-value]');
      var trigger = root.querySelector('.permit-city-picker-trigger');
      var panel = root.querySelector('.permit-city-picker-panel');
      var search = root.querySelector('.permit-city-picker-search');
      var labelEl = root.querySelector('.permit-city-picker-label');
      var emptyMsg = root.querySelector('.permit-city-picker-empty');

      if (!hidden || !trigger || !panel || !labelEl) return;

      function allGroups() {
        return root.querySelectorAll('.permit-city-picker-group');
      }

      function allOptions() {
        return root.querySelectorAll('.permit-city-picker-option');
      }

      function setOpen(open) {
        panel.classList.toggle('hidden', !open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          if (search) {
            search.value = '';
            applySearch('');
            search.focus();
          }
        }
      }

      function applySearch(query) {
        var q = String(query || '').trim().toLowerCase();
        var visibleOptions = 0;

        allGroups().forEach(function (group) {
          var groupVisible = false;
          group.querySelectorAll('.permit-city-picker-option').forEach(function (opt) {
            var hay = String(opt.getAttribute('data-search') || opt.textContent || '').toLowerCase();
            var match = !q || hay.indexOf(q) >= 0;
            opt.classList.toggle('hidden', !match);
            if (match) {
              groupVisible = true;
              visibleOptions += 1;
            }
          });
          group.classList.toggle('hidden', !groupVisible);
        });

        if (emptyMsg) emptyMsg.classList.toggle('hidden', visibleOptions > 0);
      }

      function formatLabel(city, state, fallback) {
        var base = String(fallback || city || '').trim();
        var st = String(state || '').trim();
        if (!base) return 'Select a supported city…';
        return st ? base + ' (' + st + ')' : base;
      }

      function selectOption(opt) {
        var city = opt.getAttribute('data-city') || '';
        var state = opt.getAttribute('data-state') || '';
        var label = opt.getAttribute('data-label') || opt.textContent.trim();
        hidden.value = city;
        hidden.setAttribute('data-state', state);
        labelEl.textContent = formatLabel(city, state, label);
        allOptions().forEach(function (item) {
          item.classList.toggle('is-selected', item === opt);
        });
        setOpen(false);
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(panel.classList.contains('hidden'));
      });

      allOptions().forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.preventDefault();
          selectOption(opt);
        });
      });

      if (search) {
        search.addEventListener('input', function () {
          applySearch(search.value);
        });
        search.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
            trigger.focus();
          }
        });
      }

      document.addEventListener('click', function (e) {
        if (!root.contains(e.target)) setOpen(false);
      });

      root.openPermitCityPicker = function () {
        setOpen(true);
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPermitCityPickers);
  } else {
    initPermitCityPickers();
  }
})();
