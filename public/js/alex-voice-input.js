/**
 * Voice dictation for the Alex chat surfaces (full /chat page, floating chat, AI search bar).
 *
 *   var voice = AlexVoice.attach({ button, input, onState });
 *   voice.cancel();   // drop any recording / transcription in progress
 *
 * Live browser speech recognition when it works; otherwise records audio and POSTs it to
 * /api/voice/transcribe. Dictated text only ever lands in the input — it is never sent.
 */
(function () {
  'use strict';

  if (window.AlexVoice) return;

  var MAX_MS = 120000;
  var LIVE_SILENCE_MS = 3500;
  var LIVE_NO_SPEECH_MS = 9000;
  var MIN_BLOB_BYTES = 800;
  var ENDPOINT = '/api/voice/transcribe';
  var DENIED_MSG =
    'Microphone blocked. On iPhone: Settings → Safari → Microphone (or Settings → [app] if installed) → Allow.';
  var LIVE_FATAL = { 'not-allowed': 1, 'service-not-allowed': 1, network: 1, 'audio-capture': 1, 'language-not-supported': 1 };

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var liveBroken = false;
  var controllers = [];

  var ICONS =
    '<svg class="alex-voice-icon alex-voice-icon--mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"/></svg>' +
    '<svg class="alex-voice-icon alex-voice-icon--stop" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>' +
    '<span class="alex-voice-icon alex-voice-icon--spin" aria-hidden="true"></span>';

  function isStandalone() {
    try {
      if (window.navigator.standalone === true) return true;
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (_) {
      return false;
    }
  }

  function isAppleWebKit() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
  }

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function liveAllowed() {
    return !!SR && !isStandalone();
  }

  function useLive() {
    return liveAllowed() && !liveBroken;
  }

  function isSupported() {
    return canRecord() || liveAllowed();
  }

  function pickMimeType() {
    if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    var list = isAppleWebKit()
      ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (var i = 0; i < list.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(list[i])) return list[i];
      } catch (_) {
        /* keep looking */
      }
    }
    return '';
  }

  function langParam() {
    var two = String(navigator.language || '').slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(two) ? '?lang=' + two : '';
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function joinText(base, extra) {
    extra = String(extra || '').trim();
    if (!extra) return base;
    if (!base) return extra;
    return base + (/\s$/.test(base) ? '' : ' ') + extra;
  }

  function attach(opts) {
    opts = opts || {};
    var button = opts.button;
    var input = opts.input;
    var onState = typeof opts.onState === 'function' ? opts.onState : function () {};
    if (!button || !input) return null;
    if (button.__alexVoice) return button.__alexVoice;

    if (!isSupported()) {
      button.hidden = true;
      return null;
    }

    var idleLabel = button.getAttribute('aria-label') || 'Dictate message';
    var state = 'idle';
    var session = 0;
    var startedAt = 0;
    var tickTimer = null;
    var capTimer = null;
    var hideTimer = null;
    var silenceTimer = null;

    var rec = null; // SpeechRecognition
    var liveBase = '';
    var liveFinal = '';
    var liveHeard = false;

    var recorder = null;
    var stream = null;
    var chunks = [];
    var discard = false;
    var awaitingMic = false;
    var fetchAbort = null;

    if (!button.querySelector('.alex-voice-icon')) button.innerHTML = ICONS;
    button.classList.add('alex-voice-btn');
    button.setAttribute('aria-pressed', 'false');
    button.hidden = false;

    var status = document.createElement('div');
    status.className = 'alex-voice-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    document.body.appendChild(status);

    function placeStatus() {
      if (status.hidden) return;
      var r = button.getBoundingClientRect();
      var w = status.offsetWidth;
      var h = status.offsetHeight;
      var vw = document.documentElement.clientWidth || window.innerWidth;
      var left = Math.min(Math.max(8, r.right - w), vw - w - 8);
      var top = r.top - h - 8;
      if (top < 8) top = r.bottom + 8;
      status.style.left = Math.round(left) + 'px';
      status.style.top = Math.round(top) + 'px';
    }

    function showStatus(text, kind, autoHideMs) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      status.textContent = text;
      status.setAttribute('data-kind', kind || 'info');
      status.hidden = false;
      placeStatus();
      if (autoHideMs) {
        hideTimer = setTimeout(hideStatus, autoHideMs);
      }
    }

    function hideStatus() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      status.hidden = true;
    }

    function setState(next, detail) {
      state = next;
      button.setAttribute('data-state', next);
      var listening = next === 'listening';
      button.setAttribute('aria-pressed', listening ? 'true' : 'false');
      button.setAttribute('aria-label', listening ? 'Stop recording' : next === 'transcribing' ? 'Transcribing' : idleLabel);
      button.disabled = next === 'transcribing';
      try {
        onState(next, detail || {});
      } catch (_) {
        /* surface callbacks must not break dictation */
      }
    }

    function error(message, ms) {
      setState('error', { message: message });
      showStatus(message, 'error', ms || 6000);
      setTimeout(function () {
        if (state === 'error') setState('idle');
      }, 400);
    }

    function clearTimers() {
      if (tickTimer) clearInterval(tickTimer);
      if (capTimer) clearTimeout(capTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      tickTimer = capTimer = silenceTimer = null;
    }

    function startClock(prefix) {
      startedAt = Date.now();
      var render = function () {
        showStatus(prefix + ' ' + fmtClock(Date.now() - startedAt) + ' / 2:00', 'live');
      };
      render();
      tickTimer = setInterval(render, 500);
    }

    function writeInput(value, commit) {
      var max = input.maxLength > 0 ? input.maxLength : 0;
      if (max && value.length > max) value = value.slice(0, max);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (commit) {
        try {
          input.focus({ preventScroll: true });
        } catch (_) {
          input.focus();
        }
        try {
          input.setSelectionRange(value.length, value.length);
        } catch (_) {
          /* type=search on some engines */
        }
        if (input.tagName === 'TEXTAREA') input.scrollTop = input.scrollHeight;
      }
    }

    // ── Live (browser speech recognition) ─────────────────────────────────────

    function armSilence(ms) {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(function () {
        if (state === 'listening' && rec) stop();
      }, ms);
    }

    function startLive() {
      var mySession = ++session;
      try {
        rec = new SR();
      } catch (_) {
        liveBroken = true;
        return startRecording();
      }
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      liveBase = input.value;
      liveFinal = '';
      liveHeard = false;

      rec.onresult = function (e) {
        if (mySession !== session) return;
        var fin = '';
        var interim = '';
        for (var i = 0; i < e.results.length; i++) {
          var t = e.results[i][0] ? e.results[i][0].transcript : '';
          if (e.results[i].isFinal) fin += t;
          else interim += t;
        }
        liveFinal = fin;
        if ((fin + interim).trim()) liveHeard = true;
        writeInput(joinText(liveBase, (fin + ' ' + interim).replace(/\s+/g, ' ')), false);
        armSilence(LIVE_SILENCE_MS);
      };
      rec.onerror = function (e) {
        if (mySession !== session) return;
        var code = (e && e.error) || '';
        if (LIVE_FATAL[code] && !liveHeard) {
          liveBroken = true;
          teardownLive();
          setState('idle');
          if (code === 'not-allowed' && !canRecord()) return error(DENIED_MSG, 9000);
          if (canRecord()) return startRecording();
          return error('Voice input is not available here.');
        }
        if (code === 'no-speech') {
          teardownLive();
          return error("Didn't catch that. Tap the mic and try again.", 3500);
        }
      };
      rec.onend = function () {
        if (mySession !== session) return;
        if (state === 'listening') finishLive();
      };

      try {
        rec.start();
      } catch (_) {
        liveBroken = true;
        rec = null;
        return startRecording();
      }
      setState('listening', { mode: 'live' });
      startClock('Listening…');
      capTimer = setTimeout(stop, MAX_MS);
      armSilence(LIVE_NO_SPEECH_MS);
    }

    function teardownLive() {
      clearTimers();
      if (rec) {
        rec.onresult = rec.onerror = rec.onend = null;
        try {
          rec.abort();
        } catch (_) {
          /* already stopped */
        }
      }
      rec = null;
    }

    function finishLive() {
      var text = liveFinal;
      teardownLive();
      session++;
      hideStatus();
      setState('idle');
      writeInput(joinText(liveBase, text), true);
      if (!String(text || '').trim()) showStatus("Didn't catch that. Tap the mic and try again.", 'info', 3000);
    }

    // ── Record + server transcription ─────────────────────────────────────────

    function releaseStream() {
      if (stream) {
        stream.getTracks().forEach(function (t) {
          try {
            t.stop();
          } catch (_) {
            /* ignore */
          }
        });
      }
      stream = null;
    }

    function startRecording() {
      if (!canRecord()) return error('Voice input is not available in this browser.');
      var mySession = ++session;
      discard = false;
      chunks = [];
      awaitingMic = true;
      setState('listening', { mode: 'record', phase: 'permission' });
      showStatus('Starting microphone…', 'info');
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (s) {
          awaitingMic = false;
          if (mySession !== session) {
            s.getTracks().forEach(function (t) {
              t.stop();
            });
            return;
          }
          stream = s;
          var mime = pickMimeType();
          try {
            recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
          } catch (_) {
            recorder = new MediaRecorder(stream);
          }
          recorder.ondataavailable = function (e) {
            if (e.data && e.data.size) chunks.push(e.data);
          };
          recorder.onstop = function () {
            var type = (recorder && recorder.mimeType) || mime || 'audio/webm';
            var blob = new Blob(chunks, { type: type });
            chunks = [];
            recorder = null;
            releaseStream();
            clearTimers();
            if (discard || mySession !== session) return;
            upload(blob, mySession);
          };
          recorder.start(1000);
          setState('listening', { mode: 'record' });
          startClock('Recording');
          capTimer = setTimeout(stop, MAX_MS);
        })
        .catch(function (err) {
          awaitingMic = false;
          if (mySession !== session) return;
          releaseStream();
          hideStatus();
          setState('idle');
          var name = (err && err.name) || '';
          if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
            return error(DENIED_MSG, 9000);
          }
          if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            return error('No microphone found.');
          }
          error('Could not start the microphone.');
        });
    }

    function upload(blob, mySession) {
      if (!blob || blob.size < MIN_BLOB_BYTES) {
        hideStatus();
        setState('idle');
        return showStatus("Didn't catch that. Hold the mic a little longer.", 'info', 3000);
      }
      setState('transcribing', { mode: 'record' });
      showStatus('Transcribing…', 'info');
      fetchAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      fetch(ENDPOINT + langParam(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': blob.type || 'audio/webm', Accept: 'application/json' },
        body: blob,
        signal: fetchAbort ? fetchAbort.signal : undefined,
      })
        .then(function (r) {
          return r
            .json()
            .catch(function () {
              return {};
            })
            .then(function (d) {
              d.__status = r.status;
              return d;
            });
        })
        .then(function (d) {
          if (mySession !== session) return;
          fetchAbort = null;
          if (!d.success) {
            if (d.__status === 401) return error('Your session expired. Sign in again to use voice.');
            return error(d.error || 'Could not transcribe that. Try again.', 7000);
          }
          hideStatus();
          setState('idle');
          var text = String(d.text || '').trim();
          if (!text) return showStatus("Didn't catch that. Try again a bit closer to the mic.", 'info', 3500);
          writeInput(joinText(input.value, text), true);
        })
        .catch(function (err) {
          if (mySession !== session) return;
          fetchAbort = null;
          if (err && err.name === 'AbortError') return;
          error('Connection error. Check your internet and try again.');
        });
    }

    // ── Controls ──────────────────────────────────────────────────────────────

    function start() {
      hideStatus();
      if (useLive()) return startLive();
      return startRecording();
    }

    function stop() {
      if (awaitingMic) return cancel();
      if (rec && state === 'listening') {
        clearTimers();
        showStatus('Finishing…', 'info');
        try {
          rec.stop();
        } catch (_) {
          finishLive();
        }
        // Some engines never fire onend after stop(); commit anyway.
        var s = session;
        setTimeout(function () {
          if (s === session && rec) finishLive();
        }, 1500);
        return;
      }
      if (recorder && recorder.state !== 'inactive') {
        clearTimers();
        try {
          recorder.stop();
        } catch (_) {
          releaseStream();
          setState('idle');
        }
      }
    }

    function cancel() {
      session++;
      discard = true;
      awaitingMic = false;
      clearTimers();
      if (rec) {
        var committed = liveFinal;
        teardownLive();
        if (state === 'listening') writeInput(joinText(liveBase, committed), false);
      }
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (_) {
          /* ignore */
        }
      }
      recorder = null;
      releaseStream();
      if (fetchAbort) {
        try {
          fetchAbort.abort();
        } catch (_) {
          /* ignore */
        }
      }
      fetchAbort = null;
      hideStatus();
      if (state !== 'idle') setState('idle');
    }

    button.addEventListener('mousedown', function (e) {
      // Keep focus (and the iOS keyboard / search popover) on the input.
      e.preventDefault();
    });
    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state === 'listening') return stop();
      if (state === 'transcribing') return;
      start();
    });

    window.addEventListener('resize', placeStatus);
    window.addEventListener('scroll', placeStatus, true);

    var ctl = {
      cancel: cancel,
      stop: stop,
      getState: function () {
        return state;
      },
      mode: function () {
        return useLive() ? 'live' : 'record';
      },
    };
    button.__alexVoice = ctl;
    setState('idle');
    controllers.push(ctl);
    return ctl;
  }

  window.addEventListener('pagehide', function () {
    controllers.forEach(function (c) {
      c.cancel();
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    controllers.forEach(function (c) {
      if (c.getState() === 'listening') c.stop();
    });
  });

  window.AlexVoice = {
    attach: attach,
    isSupported: isSupported,
    cancelAll: function () {
      controllers.forEach(function (c) {
        c.cancel();
      });
    },
    _forceRecordMode: function () {
      liveBroken = true;
    },
  };
  try {
    document.dispatchEvent(new CustomEvent('alexvoice:ready'));
  } catch (_) {
    /* old engines */
  }
})();
