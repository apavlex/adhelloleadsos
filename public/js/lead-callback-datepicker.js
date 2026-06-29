/**
 * Compact branded date picker for Schedule callback (replaces native type=date).
 */
(function () {
  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  var WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function toIsoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseIsoDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    var dt = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (dt.getFullYear() !== parseInt(m[1], 10)) return null;
    if (dt.getMonth() !== parseInt(m[2], 10) - 1) return null;
    if (dt.getDate() !== parseInt(m[3], 10)) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function sameDay(a, b) {
    return (
      a &&
      b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatDisplay(iso) {
    var d = parseIsoDate(iso);
    if (!d) return 'Select date';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function initCallbackDatePicker() {
    var hidden = document.getElementById('leadCallbackDate');
    var trigger = document.getElementById('leadCallbackDateTrigger');
    var popover = document.getElementById('leadCallbackDatePopover');
    if (!hidden || !trigger || !popover) return;

    var labelEl = trigger.querySelector('[data-date-label]');
    var monthLabel = popover.querySelector('[data-cal-month]');
    var gridEl = popover.querySelector('[data-cal-grid]');
    var anchor = trigger.closest('.adhello-date-field') || trigger.parentElement;
    var portalHost =
      document.getElementById('leadPanelSheet') ||
      document.getElementById('mobilePanel') ||
      document.body;

    var viewDate = new Date();
    viewDate.setHours(0, 0, 0, 0);
    var selected = parseIsoDate(hidden.value);
    var open = false;
    var placeholder = document.createComment('adhello-cal-anchor');

    function syncLabel() {
      if (labelEl) {
        labelEl.textContent = formatDisplay(hidden.value);
        labelEl.classList.toggle('adhello-date-trigger__label--empty', !hidden.value);
      }
    }

    function renderGrid() {
      if (!gridEl || !monthLabel) return;
      var y = viewDate.getFullYear();
      var mo = viewDate.getMonth();
      monthLabel.textContent = MONTHS[mo] + ' ' + y;

      var first = new Date(y, mo, 1);
      var startOffset = first.getDay();
      var daysInMonth = new Date(y, mo + 1, 0).getDate();
      var today = new Date();
      today.setHours(0, 0, 0, 0);

      var html = '';
      WEEKDAYS.forEach(function (wd) {
        html += '<span class="adhello-mini-calendar__dow">' + wd + '</span>';
      });

      for (var i = 0; i < startOffset; i++) {
        html += '<span class="adhello-mini-calendar__pad" aria-hidden="true"></span>';
      }

      for (var day = 1; day <= daysInMonth; day++) {
        var cellDate = new Date(y, mo, day);
        var iso = toIsoDate(cellDate);
        var classes = ['adhello-mini-calendar__day'];
        if (sameDay(cellDate, today)) classes.push('is-today');
        if (selected && sameDay(cellDate, selected)) classes.push('is-selected');
        html +=
          '<button type="button" class="' +
          classes.join(' ') +
          '" data-cal-day="' +
          iso +
          '" aria-label="' +
          cellDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }) +
          '">' +
          day +
          '</button>';
      }

      gridEl.innerHTML = html;
    }

    function calendarPopoverSolidBg() {
      return document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff';
    }

    function applyCalendarPopoverSurface() {
      if (!popover) return;
      var bg = calendarPopoverSolidBg();
      var shadow =
        '0 20px 40px -12px rgba(17, 24, 39, 0.18), 0 8px 16px -8px rgba(17, 24, 39, 0.1)';
      popover.style.setProperty('background-color', bg, 'important');
      popover.style.setProperty('background-image', 'none', 'important');
      popover.style.setProperty('background', bg, 'important');
      popover.style.setProperty('backdrop-filter', 'none', 'important');
      popover.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      popover.style.setProperty('opacity', '1', 'important');
      popover.style.setProperty('isolation', 'isolate', 'important');
      popover.style.setProperty('box-shadow', shadow, 'important');
      popover.style.setProperty('z-index', '10050', 'important');
      if (typeof window.applyPortaledPopoverSurface === 'function') {
        window.applyPortaledPopoverSurface(popover);
      }
      popover.querySelectorAll('.adhello-mini-calendar__surface').forEach(function (inner) {
        inner.style.setProperty('background-color', bg, 'important');
        inner.style.setProperty('background-image', 'none', 'important');
        inner.style.setProperty('background', bg, 'important');
      });
      ['.adhello-mini-calendar__head', '.adhello-mini-calendar__grid', '.adhello-mini-calendar__foot'].forEach(
        function (sel) {
          popover.querySelectorAll(sel).forEach(function (node) {
            node.style.setProperty('background-color', bg, 'important');
            node.style.setProperty('background', bg, 'important');
          });
        },
      );
    }

    function positionPopover() {
      var rect = trigger.getBoundingClientRect();
      var width = Math.max(252, Math.min(280, rect.width));
      var left = rect.left;
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
      if (left < 12) left = 12;

      var top = rect.bottom + 6;
      var popH = popover.offsetHeight || 290;
      if (top + popH > window.innerHeight - 12) {
        top = Math.max(12, rect.top - popH - 6);
      }

      popover.style.position = 'fixed';
      popover.style.top = top + 'px';
      popover.style.left = left + 'px';
      popover.style.width = width + 'px';
      applyCalendarPopoverSurface();
    }

    function openPicker() {
      if (open) return;
      open = true;
      if (selected) viewDate = new Date(selected.getTime());
      renderGrid();
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(placeholder, anchor.nextSibling);
      }
      if (popover.parentElement !== portalHost) {
        portalHost.appendChild(popover);
      }
      applyCalendarPopoverSurface();
      popover.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      positionPopover();
    }

    function closePicker() {
      if (!open) return;
      open = false;
      popover.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      if (anchor && placeholder.parentNode) {
        anchor.parentNode.insertBefore(popover, placeholder);
        placeholder.remove();
      }
    }

    function pickIso(iso) {
      hidden.value = iso;
      selected = parseIsoDate(iso);
      syncLabel();
      closePicker();
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }

    trigger.addEventListener('click', function () {
      if (open) closePicker();
      else openPicker();
    });

    popover.addEventListener('click', function (e) {
      var dayBtn = e.target.closest('[data-cal-day]');
      if (dayBtn) {
        pickIso(dayBtn.getAttribute('data-cal-day'));
        return;
      }
      if (e.target.closest('[data-cal-prev]')) {
        viewDate.setMonth(viewDate.getMonth() - 1);
        renderGrid();
        positionPopover();
        return;
      }
      if (e.target.closest('[data-cal-next]')) {
        viewDate.setMonth(viewDate.getMonth() + 1);
        renderGrid();
        positionPopover();
        return;
      }
      if (e.target.closest('[data-cal-today]')) {
        var t = new Date();
        t.setHours(0, 0, 0, 0);
        viewDate = new Date(t.getTime());
        pickIso(toIsoDate(t));
        return;
      }
      if (e.target.closest('[data-cal-clear]')) {
        hidden.value = '';
        selected = null;
        syncLabel();
        closePicker();
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    document.addEventListener('click', function (e) {
      if (!open) return;
      if (trigger.contains(e.target) || popover.contains(e.target)) return;
      closePicker();
    });

    document.addEventListener('keydown', function (e) {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closePicker();
        trigger.focus();
      }
    });

    window.addEventListener(
      'resize',
      function () {
        if (open) positionPopover();
      },
      { passive: true },
    );

    var scrollHost = document.getElementById('leadPanelTabScroll');
    if (scrollHost) {
      scrollHost.addEventListener(
        'scroll',
        function () {
          if (open) positionPopover();
        },
        { passive: true },
      );
    }

    syncLabel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCallbackDatePicker);
  } else {
    initCallbackDatePicker();
  }
})();
