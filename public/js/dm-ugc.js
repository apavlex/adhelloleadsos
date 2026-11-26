/**
 * Marketing Studio → UGC. Three paid Treg steps from https://treg.to/ugc.
 */
(function () {
  var panel = document.getElementById('dmUgcPanel');
  if (!panel) return;

  var ready = panel.getAttribute('data-treg-ready') === '1';
  var statusEl = document.getElementById('dmUgcStatus');
  var priceEl = document.getElementById('dmUgcPrice');
  var trendsEl = document.getElementById('dmUgcTrends');
  var still = document.getElementById('dmUgcCharacterImg');
  var video = document.getElementById('dmUgcVideo');
  var videoLink = document.getElementById('dmUgcVideoLink');
  var characterUrl = '';
  var polling = false;

  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function money(duration, resolution) {
    var seconds = duration === '8' ? 8 : 5;
    var rate = resolution === '720p' ? 0.27 : 0.12;
    return (seconds * rate).toFixed(2);
  }

  function refreshPrice() {
    if (!priceEl) return;
    var duration = val('dmUgcDuration') || '5';
    var resolution = val('dmUgcResolution') || '480p';
    priceEl.textContent =
      'About $' +
      money(duration, resolution) +
      ' for a ' +
      duration +
      's ' +
      resolution +
      ' clip. Failed takes are not billed.';
  }

  async function post(path, body) {
    var res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok || data.success === false) {
      throw new Error((data && data.error) || 'Treg could not start that step.');
    }
    return data;
  }

  async function poll(jobId, label) {
    var tries = 0;
    polling = true;
    try {
      while (tries < 40) {
        tries += 1;
        setStatus(label + '…');
        var res = await fetch('/direct-mail/api/ugc/jobs/' + encodeURIComponent(jobId), {
          headers: { Accept: 'application/json' },
        });
        var data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || data.success === false) {
          throw new Error((data && data.error) || 'Could not check the UGC job.');
        }
        if (data.status === 'failed') throw new Error(data.error || 'Treg could not finish this step.');
        if (data.status === 'completed') return data;
        await new Promise(function (resolve) {
          setTimeout(resolve, 8000);
        });
      }
      throw new Error('Still rendering. Wait here a little longer before starting another clip — a new click bills another take.');
    } finally {
      polling = false;
    }
  }

  var durationEl = document.getElementById('dmUgcDuration');
  var resolutionEl = document.getElementById('dmUgcResolution');
  if (durationEl) durationEl.addEventListener('change', refreshPrice);
  if (resolutionEl) resolutionEl.addEventListener('change', refreshPrice);
  refreshPrice();

  var trendsBtn = document.getElementById('dmUgcTrendsBtn');
  if (trendsBtn) {
    trendsBtn.addEventListener('click', async function () {
      if (!ready || polling) return;
      trendsBtn.disabled = true;
      setStatus('Looking up videos in this niche…');
      try {
        var data = await post('/direct-mail/api/ugc/trends', { q: val('dmUgcNiche') });
        if (trendsEl) {
          trendsEl.innerHTML = '';
          (data.videos || []).forEach(function (videoRow) {
            var li = document.createElement('li');
            var btn = document.createElement('button');
            btn.type = 'button';
            var views = videoRow.views ? ' · ' + Number(videoRow.views).toLocaleString() + ' views' : '';
            btn.textContent = (videoRow.title || videoRow.url || 'Untitled') + views;
            btn.addEventListener('click', function () {
              var hook = document.getElementById('dmUgcHook');
              if (hook) hook.value = videoRow.title || '';
            });
            li.appendChild(btn);
            trendsEl.appendChild(li);
          });
          if (!(data.videos || []).length) {
            var empty = document.createElement('li');
            empty.textContent = 'No videos came back. Try a broader niche.';
            trendsEl.appendChild(empty);
          }
        }
        setStatus('Click a hook to use its caption as the spoken line.');
      } catch (err) {
        setStatus(err.message || 'Could not study this niche.');
      } finally {
        trendsBtn.disabled = !ready;
      }
    });
  }

  var characterBtn = document.getElementById('dmUgcCharacterBtn');
  if (characterBtn) {
    characterBtn.addEventListener('click', async function () {
      if (!ready || polling) return;
      characterBtn.disabled = true;
      setStatus('Creating the character. About $0.03.');
      try {
        var started = await post('/direct-mail/api/ugc/character', {
          product: val('dmUgcProduct'),
          presenter: val('dmUgcPresenter'),
          prompt: val('dmUgcCharacterPrompt'),
        });
        var done = started.imageUrl
          ? started
          : await poll(started.jobId, 'Rendering the character');
        characterUrl = done.imageUrl || '';
        if (still && characterUrl) {
          still.src = characterUrl;
          still.classList.remove('hidden');
        }
        setStatus(characterUrl ? 'Character ready. Write the line, then generate the clip.' : 'Character finished without an image.');
      } catch (err) {
        setStatus(err.message || 'Could not create the character.');
      } finally {
        characterBtn.disabled = !ready;
      }
    });
  }

  var clipBtn = document.getElementById('dmUgcClipBtn');
  if (clipBtn) {
    clipBtn.addEventListener('click', async function () {
      if (!ready || polling) return;
      if (!characterUrl) {
        setStatus('Create a character first.');
        return;
      }
      var duration = val('dmUgcDuration') || '5';
      var resolution = val('dmUgcResolution') || '480p';
      clipBtn.disabled = true;
      setStatus('Starting a ' + duration + 's ' + resolution + ' clip. About $' + money(duration, resolution) + '.');
      try {
        var started = await post('/direct-mail/api/ugc/clip', {
          hook: val('dmUgcHook'),
          product: val('dmUgcProduct'),
          imageUrl: characterUrl,
          audioUrl: val('dmUgcAudio'),
          duration: duration,
          resolution: resolution,
        });
        var done = started.videoUrl ? started : await poll(started.jobId, 'Rendering the clip');
        if (video && done.videoUrl) {
          video.src = done.videoUrl;
          video.classList.remove('hidden');
        }
        if (videoLink && done.videoUrl) {
          videoLink.href = done.videoUrl;
          videoLink.classList.remove('hidden');
        }
        setStatus(done.videoUrl ? 'Clip ready. The file link lasts about a week.' : 'Clip finished without a video URL.');
      } catch (err) {
        setStatus(err.message || 'Could not generate the clip.');
      } finally {
        clipBtn.disabled = !ready;
      }
    });
  }
})();
