/**
 * Google Calendar–style date + time picker for a hidden datetime-local-compatible input.
 */
(function (global) {
  'use strict';

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toLocalInputValue(d) {
    if (!d || Number.isNaN(d.getTime())) return '';
    return (
      d.getFullYear() +
      '-' +
      pad2(d.getMonth() + 1) +
      '-' +
      pad2(d.getDate()) +
      'T' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    );
  }

  function parseLocalValue(v) {
    var s = String(v || '').trim();
    if (!s) return null;
    var d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
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

  function formatDisplay(d) {
    if (!d) return 'Select date & time';
    return d.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function roundToNextQuarterHour(d) {
    var out = new Date(d.getTime());
    out.setSeconds(0, 0);
    var m = out.getMinutes();
    var add = (15 - (m % 15)) % 15;
    if (add === 0 && d.getSeconds() > 0) add = 15;
    out.setMinutes(m + add);
    return out;
  }

  function initGcalDatetimePicker(inputEl, opts) {
    if (!inputEl || inputEl.dataset.gcalPickerInit === '1') {
      return inputEl && inputEl.__gcalPicker ? inputEl.__gcalPicker : null;
    }
    opts = opts || {};
    inputEl.dataset.gcalPickerInit = '1';

    var selected = parseLocalValue(inputEl.value);
    var viewMonth = selected
      ? new Date(selected.getFullYear(), selected.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    var open = false;

    if (inputEl.type !== 'hidden') {
      inputEl.type = 'hidden';
    }
    inputEl.classList.add('gcal-datetime-value');

    var root = document.createElement('div');
    root.className = 'gcal-datetime';
    inputEl.parentNode.insertBefore(root, inputEl);
    root.appendChild(inputEl);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gcal-datetime-trigger';
    trigger.id = opts.triggerId || inputEl.id + '-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML =
      '<span class="gcal-datetime-display"></span>' +
      '<svg class="gcal-datetime-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' +
      '</svg>';

    var pop = document.createElement('div');
    pop.className = 'gcal-datetime-popover hidden';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', opts.label || 'Choose date and time');
    pop.innerHTML =
      '<div class="gcal-datetime-header">' +
      '<button type="button" class="gcal-datetime-nav" data-nav="-1" aria-label="Previous month">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>' +
      '</button>' +
      '<div class="gcal-datetime-month" aria-live="polite"></div>' +
      '<button type="button" class="gcal-datetime-nav" data-nav="1" aria-label="Next month">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="gcal-datetime-weekdays" aria-hidden="true">' +
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span>' + d + '</span>'; }).join('') +
      '</div>' +
      '<div class="gcal-datetime-grid" role="grid" aria-label="Calendar days"></div>' +
      '<div class="gcal-datetime-time">' +
      '<span class="gcal-datetime-time-label">Time</span>' +
      '<select class="gcal-datetime-hour" aria-label="Hour"></select>' +
      '<span class="gcal-datetime-time-sep">:</span>' +
      '<select class="gcal-datetime-minute" aria-label="Minute"></select>' +
      '<select class="gcal-datetime-ampm" aria-label="AM or PM"></select>' +
      '</div>' +
      '<div class="gcal-datetime-footer">' +
      '<button type="button" class="gcal-datetime-footer-btn" data-action="clear">Clear</button>' +
      '<button type="button" class="gcal-datetime-footer-btn" data-action="today">Today</button>' +
      '</div>';

    root.appendChild(trigger);
    root.appendChild(pop);

    var portalHost =
      opts.portalHost ||
      document.getElementById('leadPanelSheet') ||
      document.getElementById('mobilePanel') ||
      document.body;
    var useFixedPopover = !!opts.fixedPopover;
    var popAnchor = document.createComment('gcal-pop-anchor');

    function positionFixedPopover() {
      if (!useFixedPopover) return;
      var rect = trigger.getBoundingClientRect();
      var width = Math.max(212, Math.min(280, rect.width || 252));
      var left = rect.left;
      if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
      if (left < 12) left = 12;

      var top = rect.bottom + 6;
      var popH = pop.offsetHeight || 320;
      if (top + popH > window.innerHeight - 12) {
        top = Math.max(12, rect.top - popH - 6);
      }

      pop.style.position = 'fixed';
      pop.style.top = top + 'px';
      pop.style.left = left + 'px';
      pop.style.width = width + 'px';
      pop.style.zIndex = '10050';
    }

    function restorePopoverDom() {
      if (!useFixedPopover || pop.parentElement === root) return;
      root.appendChild(pop);
      pop.style.position = '';
      pop.style.top = '';
      pop.style.left = '';
      pop.style.width = '';
      pop.style.zIndex = '';
      if (popAnchor.parentNode) popAnchor.remove();
    }

    function mountFixedPopover() {
      if (!useFixedPopover) return;
      if (pop.parentElement === root) {
        root.parentNode.insertBefore(popAnchor, root.nextSibling);
        portalHost.appendChild(pop);
      }
      positionFixedPopover();
    }

    var displayEl = trigger.querySelector('.gcal-datetime-display');
    var monthEl = pop.querySelector('.gcal-datetime-month');
    var gridEl = pop.querySelector('.gcal-datetime-grid');
    var hourSel = pop.querySelector('.gcal-datetime-hour');
    var minSel = pop.querySelector('.gcal-datetime-minute');
    var ampmSel = pop.querySelector('.gcal-datetime-ampm');

    function fillTimeSelects(d) {
      var ref = d || selected || new Date();
      var h24 = ref.getHours();
      var h12 = h24 % 12 || 12;
      var ampm = h24 >= 12 ? 'PM' : 'AM';
      var m = ref.getMinutes();

      if (!hourSel.options.length) {
        for (var hi = 1; hi <= 12; hi += 1) {
          var ho = document.createElement('option');
          ho.value = String(hi);
          ho.textContent = String(hi);
          hourSel.appendChild(ho);
        }
        for (var mi = 0; mi < 60; mi += 1) {
          var mo = document.createElement('option');
          mo.value = String(mi);
          mo.textContent = pad2(mi);
          minSel.appendChild(mo);
        }
        ['AM', 'PM'].forEach(function (ap) {
          var ao = document.createElement('option');
          ao.value = ap;
          ao.textContent = ap;
          ampmSel.appendChild(ao);
        });
      }

      hourSel.value = String(h12);
      minSel.value = String(m);
      ampmSel.value = ampm;
    }

    function timeFromSelects(baseDate) {
      var base = baseDate || selected || new Date();
      var h12 = parseInt(hourSel.value, 10) || 12;
      var mins = parseInt(minSel.value, 10) || 0;
      var pm = ampmSel.value === 'PM';
      var h24 = h12 % 12;
      if (pm) h24 += 12;
      var out = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h24, mins, 0, 0);
      return out;
    }

    function syncInput() {
      inputEl.value = selected ? toLocalInputValue(selected) : '';
      if (displayEl) {
        displayEl.textContent = formatDisplay(selected);
        trigger.classList.toggle('gcal-datetime-trigger--empty', !selected);
      }
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderCalendar() {
      var today = new Date();
      monthEl.textContent = viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' });

      var first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      var startOffset = first.getDay();
      var start = new Date(first);
      start.setDate(first.getDate() - startOffset);

      gridEl.innerHTML = '';
      for (var i = 0; i < 42; i += 1) {
        var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gcal-datetime-day';
        btn.textContent = String(day.getDate());
        btn.setAttribute('data-date', toLocalInputValue(day).slice(0, 10));

        if (day.getMonth() !== viewMonth.getMonth()) btn.classList.add('gcal-datetime-day--muted');
        if (sameDay(day, today)) btn.classList.add('gcal-datetime-day--today');
        if (selected && sameDay(day, selected)) btn.classList.add('gcal-datetime-day--selected');
        if (opts.minDate && day < opts.minDate) {
          btn.disabled = true;
          btn.classList.add('gcal-datetime-day--disabled');
        }

        gridEl.appendChild(btn);
      }
    }

    function setOpen(next) {
      open = !!next;
      pop.classList.toggle('hidden', !open);
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        mountFixedPopover();
        fillTimeSelects(selected);
        renderCalendar();
        if (useFixedPopover) positionFixedPopover();
      } else {
        restorePopoverDom();
      }
    }

    function setValue(d) {
      selected = d ? new Date(d.getTime()) : null;
      if (selected) {
        viewMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
      }
      syncInput();
      if (open) {
        fillTimeSelects(selected);
        renderCalendar();
      }
    }

    var api = {
      setValue: setValue,
      clear: function () {
        setValue(null);
      },
      setDefaultInDays: function (days, hour, minute) {
        var d = new Date();
        d.setDate(d.getDate() + (days || 0));
        d.setHours(typeof hour === 'number' ? hour : 10, typeof minute === 'number' ? minute : 0, 0, 0);
        setValue(roundToNextQuarterHour(d));
      },
      open: function () {
        setOpen(true);
      },
      close: function () {
        setOpen(false);
      },
    };

    inputEl.__gcalPicker = api;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      setOpen(!open);
    });

    pop.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) {
        e.preventDefault();
        var delta = parseInt(nav.getAttribute('data-nav'), 10) || 0;
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
        renderCalendar();
        return;
      }

      var dayBtn = e.target.closest('.gcal-datetime-day');
      if (dayBtn && !dayBtn.disabled) {
        e.preventDefault();
        var parts = String(dayBtn.getAttribute('data-date') || '').split('-');
        var y = parseInt(parts[0], 10);
        var mo = parseInt(parts[1], 10) - 1;
        var da = parseInt(parts[2], 10);
        var next = timeFromSelects(new Date(y, mo, da));
        setValue(next);
        return;
      }

      var action = e.target.closest('[data-action]');
      if (!action) return;
      e.preventDefault();
      var kind = action.getAttribute('data-action');
      if (kind === 'clear') {
        setValue(null);
        setOpen(false);
      } else if (kind === 'today') {
        var now = roundToNextQuarterHour(new Date());
        setValue(now);
        viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        fillTimeSelects(now);
        renderCalendar();
      }
    });

    [hourSel, minSel, ampmSel].forEach(function (sel) {
      sel.addEventListener('change', function () {
        if (!selected) {
          var today = new Date();
          selected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        }
        setValue(timeFromSelects(selected));
      });
    });

    document.addEventListener('click', function (e) {
      if (!open) return;
      if (root.contains(e.target) || pop.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
      if (!open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    });

    if (useFixedPopover) {
      window.addEventListener(
        'resize',
        function () {
          if (open) positionFixedPopover();
        },
        { passive: true },
      );
      var scrollHost = document.getElementById('leadPanelTabScroll');
      if (scrollHost) {
        scrollHost.addEventListener(
          'scroll',
          function () {
            if (open) positionFixedPopover();
          },
          { passive: true },
        );
      }
    }

    syncInput();
    return api;
  }

  global.initGcalDatetimePicker = initGcalDatetimePicker;
})(typeof window !== 'undefined' ? window : globalThis);
