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

      if (!hidden || !trigger || !panel || !labelEl) return;

      function allNodes() {
        return root.querySelectorAll('[data-folder-picker-node]');
      }

      function allOptions() {
        return root.querySelectorAll('.folder-filter-picker-option');
      }

      function collapseAll() {
        root.querySelectorAll('[data-folder-picker-children]').forEach(function (childWrap) {
          childWrap.classList.add('hidden');
        });
        root.querySelectorAll('.folder-filter-picker-expand').forEach(function (btn) {
          btn.textContent = '\u25B6';
          btn.setAttribute('data-expanded', 'false');
        });
      }

      function setExpanded(expandBtn, open) {
        if (!expandBtn) return;
        var node = expandBtn.closest('[data-folder-picker-node]');
        var childWrap = node && node.querySelector(':scope > [data-folder-picker-children]');
        if (!childWrap) return;
        childWrap.classList.toggle('hidden', !open);
        expandBtn.textContent = open ? '\u25BC' : '\u25B6';
        expandBtn.setAttribute('data-expanded', open ? 'true' : 'false');
      }

      function revealNodeAndAncestors(node, visibleNodes) {
        while (node && root.contains(node)) {
          visibleNodes.add(node);
          var parentChildren = node.parentElement;
          if (!parentChildren || !parentChildren.hasAttribute('data-folder-picker-children')) break;
          parentChildren.classList.remove('hidden');
          var parentNode = parentChildren.parentElement;
          if (parentNode && parentNode.hasAttribute('data-folder-picker-node')) {
            var expandBtn = parentNode.querySelector(':scope > div > .folder-filter-picker-expand');
            if (expandBtn) {
              expandBtn.textContent = '\u25BC';
              expandBtn.setAttribute('data-expanded', 'true');
            }
            node = parentNode;
          } else {
            break;
          }
        }
      }

      function expandToSelected() {
        var selectedKey = String(hidden.value || '').trim();
        if (!selectedKey) return;
        var selectedOpt = root.querySelector('.folder-filter-picker-option[data-key="' + CSS.escape(selectedKey) + '"]');
        if (!selectedOpt) return;
        revealNodeAndAncestors(selectedOpt.closest('[data-folder-picker-node]'), new Set());
      }

      function setOpen(open) {
        panel.classList.toggle('hidden', !open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          if (search) {
            search.value = '';
            applySearch('');
          }
          collapseAll();
          expandToSelected();
          if (search) search.focus();
        }
      }

      function applySearch(query) {
        var q = String(query || '').trim().toLowerCase();
        var nodes = Array.from(allNodes());

        if (!q) {
          nodes.forEach(function (node) {
            node.classList.remove('hidden');
          });
          collapseAll();
          expandToSelected();
          if (emptyMsg) emptyMsg.classList.add('hidden');
          return;
        }

        var visibleNodes = new Set();
        allOptions().forEach(function (opt) {
          var hay = String(opt.getAttribute('data-search') || opt.textContent || '').toLowerCase();
          if (hay.indexOf(q) < 0) return;
          revealNodeAndAncestors(opt.closest('[data-folder-picker-node]'), visibleNodes);
        });

        nodes.forEach(function (node) {
          node.classList.toggle('hidden', !visibleNodes.has(node));
        });
        if (emptyMsg) emptyMsg.classList.toggle('hidden', visibleNodes.size > 0);
      }

      function selectOption(opt) {
        var key = opt.getAttribute('data-key') || '';
        var label = opt.getAttribute('data-label') || opt.textContent.trim();
        hidden.value = key;
        labelEl.textContent = label;
        allOptions().forEach(function (item) {
          var row = item.closest('[data-folder-picker-node] > div');
          if (!row) return;
          row.classList.toggle('bg-brand-yellow/15', item === opt);
          row.classList.toggle('dark:bg-brand-yellow/10', item === opt);
        });
        setOpen(false);
      }

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(panel.classList.contains('hidden'));
      });

      root.querySelectorAll('.folder-filter-picker-expand').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var open = btn.getAttribute('data-expanded') !== 'true';
          setExpanded(btn, open);
        });
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
          }
        });
      }

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
