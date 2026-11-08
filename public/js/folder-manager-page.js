(function () {
    function $(id) { return document.getElementById(id); }
    var jsonHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' };

    document.addEventListener('click', function (e) {
      var toggle = e.target.closest && e.target.closest('.folder-more-toggle');
      if (!toggle) return;
      e.preventDefault();
      var row = toggle.closest('.folder-row');
      if (!row) return;
      var open = !row.classList.contains('is-more-open');
      row.classList.toggle('is-more-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    function bindFolderManager() {
      document.querySelectorAll('.folder-rename').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          var row = btn.closest('[data-folder-row]');
          var currentName = (row && row.getAttribute('data-folder-name')) || '';
          var nextName = window.prompt('Rename folder', currentName);
          if (nextName == null || !String(nextName).trim()) return;
          fetch('/folders/rename', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ folderKey: key, name: String(nextName).trim() })
          })
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function (data) {
              if (!data || !data.success) throw new Error((data && data.error) || 'Failed');
              window.location.reload();
            })
            .catch(function () { window.alert('Could not rename folder.'); });
        });
      });

      document.querySelectorAll('.folder-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          var row = btn.closest('[data-folder-row]');
          var currentName = (row && row.getAttribute('data-folder-name')) || 'this folder';
          var isDefault = row && row.getAttribute('data-folder-is-default') === '1';
          var msg = 'Delete ' + currentName + '? Leads will be unassigned from this folder.';
          if (isDefault) msg += ' This is a system folder — it will not be recreated automatically.';
          if (btn.disabled || !window.confirm(msg)) return;
          btn.disabled = true;
          btn.textContent = 'Removing…';
          fetch('/folders/delete', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ folderKey: key })
          })
            .then(function (r) {
              return r.json().then(function (data) { return { ok: r.ok, data: data }; });
            })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Failed');
              }
              window.location.reload();
            })
            .catch(function (err) {
              btn.disabled = false;
              btn.textContent = 'Remove';
              window.alert(err && err.message ? err.message : 'Could not delete folder.');
            });
        });
      });

      document.querySelectorAll('.folder-search-setup').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          openFolderSearchSetup(key);
        });
      });

      document.querySelectorAll('.folder-run-search').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          if (!key) return;
          if (btn.disabled) return;
          btn.disabled = true;
          var originalLabel = btn.textContent;
          btn.textContent = 'Starting…';
          fetch('/folders/run-search', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ folderKey: key })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              var data = pack.data || {};
              if (!pack.ok || !data.success) {
                if (data.needSetup) {
                  openFolderSearchSetup(key);
                  var err = $('folderSearchSetupError');
                  if (err) {
                    err.textContent = data.error || 'Save search setup first.';
                    err.classList.remove('hidden');
                  }
                  return;
                }
                throw new Error(data.error || 'Could not run search.');
              }
              if (typeof window.showLeadRunProgressBanner === 'function') {
                window.showLeadRunProgressBanner({
                  keyword: data.keyword || '',
                  city: data.city || '',
                  state: data.state || '',
                  targetFolderKey: data.folderKey || key,
                  targetFolderName: data.folderName || ''
                });
              }
              var bellBadge = document.getElementById('bulkEnhanceBellBadge');
              var pingDot = document.getElementById('notificationPing');
              if (bellBadge) {
                bellBadge.textContent = 'RUN';
                bellBadge.classList.remove('hidden');
                bellBadge.setAttribute('title', 'Lead search running in background');
              }
              if (pingDot) pingDot.classList.remove('hidden');
            })
            .catch(function (err) {
              window.alert(err && err.message ? err.message : 'Could not run search.');
            })
            .then(function () {
              btn.disabled = false;
              btn.textContent = originalLabel;
            });
        });
      });

      document.querySelectorAll('.folder-move').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          var row = btn.closest('[data-folder-row]');
          var currentName = (row && row.getAttribute('data-folder-name')) || 'Folder';
          var currentParent = (row && row.getAttribute('data-folder-parent-key')) || '';
          openFolderMoveModal(key, currentName, currentParent);
        });
      });

      document.querySelectorAll('.folder-outreach-setup').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          openFolderOutreachSetup(btn.getAttribute('data-folder-key') || '');
        });
      });

      document.querySelectorAll('.folder-outreach-enabled').forEach(function (cb) {
        cb.addEventListener('change', function (e) {
          e.stopPropagation();
          var key = cb.getAttribute('data-folder-key') || '';
          if (!key) return;
          saveFolderOutreachSettings(key, { enabled: !!cb.checked }, cb).then(function (data) {
            if (!data) return;
            if (data.runStarted && typeof window.showAppToast === 'function') {
              window.showAppToast('Auto outreach started — enrolling eligible leads now.', {
                variant: 'success',
                duration: 6000,
              });
            } else if (cb.checked === false && typeof window.showAppToast === 'function') {
              window.showAppToast('Auto outreach paused for this folder.', { duration: 4000 });
            }
          }).catch(function () { /* saveFolderOutreachSettings already alerts */ });
        });
      });
    }

    function outreachSettingsFromFolder(folder) {
      var oa = folder && folder.outreachAutomation && typeof folder.outreachAutomation === 'object'
        ? folder.outreachAutomation
        : {};
      return {
        enabled: oa.enabled === true,
        maxLeads: oa.maxLeads != null ? oa.maxLeads : 25,
        tier: oa.tier || '',
        minScore: oa.minScore != null && oa.minScore !== '' ? oa.minScore : '',
        smsOnly: oa.smsOnly === true,
        senderOfferKey: oa.senderOfferKey || '',
        ghlGoal: oa.ghlGoal || '',
        ghlWorkflowPrompt: oa.ghlWorkflowPrompt || '',
        aiIcpReview: oa.aiIcpReview !== false,
        minIcpScore: oa.minIcpScore != null ? oa.minIcpScore : 8,
        serviceCities: oa.serviceCities || '',
        serviceStates: oa.serviceStates || '',
        findMissingEmail: oa.findMissingEmail !== false,
        requireEmail: oa.requireEmail === true,
      };
    }

    var ghlDefaultFolderOutreachPrompt = '';

    function captureDefaultGhlFolderPrompt() {
      var ta = $('ghlAutoOutreachPromptFolder');
      if (ta && !ghlDefaultFolderOutreachPrompt) {
        ghlDefaultFolderOutreachPrompt = ta.value || '';
      }
    }

    function setFolderGhlPromptText(text) {
      var ta = $('ghlAutoOutreachPromptFolder');
      if (!ta) return;
      captureDefaultGhlFolderPrompt();
      ta.value = text || ghlDefaultFolderOutreachPrompt || '';
    }

    function setFolderOutreachStatus(msg, isError) {
      var el = $('folderOutreachStatus');
      if (!el) return;
      if (!msg) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
      }
      el.textContent = msg;
      el.classList.remove('hidden');
      el.classList.toggle('text-red-600', !!isError);
      el.classList.toggle('dark:text-red-400', !!isError);
      el.classList.toggle('text-brand-muted', !isError);
    }

    function fillFolderOutreachForm(folder) {
      var s = outreachSettingsFromFolder(folder);
      if ($('folderOutreachEnabled')) $('folderOutreachEnabled').checked = !!s.enabled;
      if ($('folderOutreachMaxLeads')) $('folderOutreachMaxLeads').value = String(s.maxLeads);
      if ($('folderOutreachTier')) $('folderOutreachTier').value = s.tier || '';
      if ($('folderOutreachMinScore')) $('folderOutreachMinScore').value = s.minScore !== '' ? String(s.minScore) : '';
      if ($('folderOutreachSmsOnly')) $('folderOutreachSmsOnly').checked = !!s.smsOnly;
      if ($('folderOutreachAiIcpReview')) $('folderOutreachAiIcpReview').checked = s.aiIcpReview !== false;
      if ($('folderOutreachFindMissingEmail')) $('folderOutreachFindMissingEmail').checked = s.findMissingEmail !== false;
      if ($('folderOutreachRequireEmail')) $('folderOutreachRequireEmail').checked = !!s.requireEmail;
      if ($('folderOutreachMinIcpScore')) $('folderOutreachMinIcpScore').value = String(s.minIcpScore != null ? s.minIcpScore : 8);
      if ($('folderOutreachServiceCities')) $('folderOutreachServiceCities').value = s.serviceCities || '';
      if ($('folderOutreachServiceStates')) $('folderOutreachServiceStates').value = s.serviceStates || '';
      if ($('folderOutreachSenderOfferKey')) $('folderOutreachSenderOfferKey').value = s.senderOfferKey || '';
      if ($('folderOutreachGhlGoal')) $('folderOutreachGhlGoal').value = s.ghlGoal || '';
      if (s.ghlWorkflowPrompt) {
        setFolderGhlPromptText(s.ghlWorkflowPrompt);
      } else {
        setFolderGhlPromptText('');
      }
    }

    function buildFolderOutreachPayload(folderKey) {
      var promptTa = $('ghlAutoOutreachPromptFolder');
      return {
        folderKey: folderKey,
        enabled: !!($('folderOutreachEnabled') && $('folderOutreachEnabled').checked),
        maxLeads: Math.min(100, Math.max(1, parseInt(($('folderOutreachMaxLeads') && $('folderOutreachMaxLeads').value) || '25', 10) || 25)),
        tier: ($('folderOutreachTier') && $('folderOutreachTier').value) || '',
        minScore: ($('folderOutreachMinScore') && $('folderOutreachMinScore').value) || '',
        smsOnly: !!($('folderOutreachSmsOnly') && $('folderOutreachSmsOnly').checked),
        aiIcpReview: !!($('folderOutreachAiIcpReview') && $('folderOutreachAiIcpReview').checked),
        findMissingEmail: !!($('folderOutreachFindMissingEmail') && $('folderOutreachFindMissingEmail').checked),
        requireEmail: !!($('folderOutreachRequireEmail') && $('folderOutreachRequireEmail').checked),
        minIcpScore: parseFloat(($('folderOutreachMinIcpScore') && $('folderOutreachMinIcpScore').value) || '8') || 8,
        serviceCities: ($('folderOutreachServiceCities') && $('folderOutreachServiceCities').value) || '',
        serviceStates: ($('folderOutreachServiceStates') && $('folderOutreachServiceStates').value) || '',
        senderOfferKey: ($('folderOutreachSenderOfferKey') && $('folderOutreachSenderOfferKey').value) || '',
        ghlGoal: ($('folderOutreachGhlGoal') && $('folderOutreachGhlGoal').value) || '',
        ghlWorkflowPrompt: promptTa ? (promptTa.value || '') : '',
      };
    }

    function saveFolderOutreachSettings(folderKey, partial, toggleEl) {
      var folder = folderByKey(folderKey);
      var base = outreachSettingsFromFolder(folder || {});
      var body = Object.assign({ folderKey: folderKey }, base, partial || {});
      if (toggleEl) toggleEl.disabled = true;
      return fetch('/folders/save-outreach-automation', {
        method: 'POST',
        credentials: 'same-origin',
        headers: jsonHeaders,
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (pack) {
          if (!pack.ok || !pack.data || !pack.data.success) {
            throw new Error((pack.data && pack.data.error) || 'Save failed');
          }
          if (folder && pack.data.outreachAutomation) {
            folder.outreachAutomation = pack.data.outreachAutomation;
          }
          var row = null;
          document.querySelectorAll('[data-folder-row]').forEach(function (el) {
            if (el.getAttribute('data-folder-row') === folderKey) row = el;
          });
          if (row) {
            row.setAttribute('data-folder-outreach-enabled', pack.data.outreachAutomation.enabled ? '1' : '0');
            var rowCb = row.querySelector('.folder-outreach-enabled');
            if (rowCb) rowCb.checked = !!pack.data.outreachAutomation.enabled;
          }
          return pack.data;
        })
        .catch(function (err) {
          if (toggleEl) toggleEl.checked = !toggleEl.checked;
          window.alert(err && err.message ? err.message : 'Could not save folder outreach.');
          throw err;
        })
        .finally(function () {
          if (toggleEl) toggleEl.disabled = false;
        });
    }

    function openFolderOutreachSetup(folderKey) {
      var modal = $('folderOutreachModal');
      var folder = folderByKey(folderKey);
      if (!modal || !folder) return;
      if ($('folderOutreachKey')) $('folderOutreachKey').value = folderKey;
      if ($('folderOutreachSubtitle')) {
        $('folderOutreachSubtitle').textContent =
          'Enroll leads from "' + (folder.name || 'folder') + '" into GHL auto-outreach. Mobile vs landline syncs to GHL custom fields for SMS workflow branching.';
      }
      fillFolderOutreachForm(folder);
      setFolderOutreachStatus('');
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeFolderOutreachSetup() {
      var modal = $('folderOutreachModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function bindFolderOutreachModal() {
      captureDefaultGhlFolderPrompt();
      var modal = $('folderOutreachModal');
      var bd = $('folderOutreachBackdrop');
      var cancel = $('folderOutreachCancel');
      var save = $('folderOutreachSave');
      var run = $('folderOutreachRun');
      var optimize = $('folderOutreachOptimizePrompt');
      if (bd) bd.addEventListener('click', closeFolderOutreachSetup);
      if (cancel) cancel.addEventListener('click', closeFolderOutreachSetup);
      if (optimize) {
        optimize.addEventListener('click', function () {
          var key = ($('folderOutreachKey') && $('folderOutreachKey').value) || '';
          var goalEl = $('folderOutreachGhlGoal');
          var goal = goalEl ? String(goalEl.value || '').trim() : '';
          if (!key) return;
          if (!goal) {
            setFolderOutreachStatus('Enter an outreach goal first.', true);
            if (goalEl) goalEl.focus();
            return;
          }
          var promptTa = $('ghlAutoOutreachPromptFolder');
          optimize.disabled = true;
          optimize.textContent = 'Optimizing…';
          setFolderOutreachStatus('Generating GHL prompt…');
          fetch('/folders/optimize-ghl-prompt', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({
              folderKey: key,
              ghlGoal: goal,
              senderOfferKey: ($('folderOutreachSenderOfferKey') && $('folderOutreachSenderOfferKey').value) || '',
              basePrompt: promptTa ? (promptTa.value || '') : '',
            }),
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Optimize failed');
              }
              if (pack.data.workflowPrompt) {
                setFolderGhlPromptText(pack.data.workflowPrompt);
              }
              var folder = folderByKey(key);
              if (folder && pack.data.outreachAutomation) {
                folder.outreachAutomation = pack.data.outreachAutomation;
              }
              var warn = pack.data.warning ? (' ' + pack.data.warning) : '';
              setFolderOutreachStatus('Prompt optimized and saved for this goal. Copy it into GHL.' + warn);
            })
            .catch(function (err) {
              setFolderOutreachStatus(err && err.message ? err.message : 'Optimize failed.', true);
            })
            .finally(function () {
              optimize.disabled = false;
              optimize.textContent = 'Optimize prompt for GHL';
            });
        });
      }
      if (save) {
        save.addEventListener('click', function () {
          var key = ($('folderOutreachKey') && $('folderOutreachKey').value) || '';
          if (!key) return;
          save.disabled = true;
          saveFolderOutreachSettings(key, buildFolderOutreachPayload(key))
            .then(function (data) {
              var on = !!(data.outreachAutomation && data.outreachAutomation.enabled);
              setFolderOutreachStatus(
                on
                  ? (data.runStarted
                    ? 'Saved. Auto outreach is ON — enrolling eligible leads now (then daily). Safe to close the app.'
                    : 'Saved. Auto outreach is ON — it runs in the background. Safe to close the app.')
                  : 'Saved. Outreach disabled for this folder.',
              );
              if (on && typeof window.showAppToast === 'function') {
                window.showAppToast(
                  data.runStarted
                    ? 'Auto outreach started — enrolling now. Safe to close this tab.'
                    : 'Auto outreach is live on the server. Safe to close this tab — enrolls continue in the background.',
                  { variant: 'success', duration: 7000 },
                );
              }
              setTimeout(function () { window.location.reload(); }, 900);
            })
            .catch(function () { setFolderOutreachStatus('Save failed.', true); })
            .finally(function () { save.disabled = false; });
        });
      }
      if (run) {
        run.addEventListener('click', function () {
          var key = ($('folderOutreachKey') && $('folderOutreachKey').value) || '';
          if (!key) return;
          run.disabled = true;
          var payload = buildFolderOutreachPayload(key);
          saveFolderOutreachSettings(key, payload)
            .then(function () {
              return fetch('/folders/outreach/run', {
                method: 'POST',
                credentials: 'same-origin',
                headers: jsonHeaders,
                body: JSON.stringify({ folderKey: key, maxLeads: payload.maxLeads }),
              });
            })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Run failed');
              }
              setFolderOutreachStatus('Enrolled ' + (pack.data.enrolled || 0) + ' lead(s) into GHL auto-outreach.');
              setTimeout(function () { window.location.reload(); }, 900);
            })
            .catch(function (err) {
              setFolderOutreachStatus(err && err.message ? err.message : 'Run failed.', true);
            })
            .finally(function () { run.disabled = false; });
        });
      }
      if (modal) {
        modal.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') closeFolderOutreachSetup();
        });
      }
    }

    function collectFolderDescendantKeys(folderKey, folders) {
      var root = String(folderKey || '').trim();
      var blocked = new Set();
      if (!root) return blocked;
      var byParent = new Map();
      (folders || []).forEach(function (f) {
        if (!f || !f.key) return;
        var parent = String(f.parentFolderKey || '').trim();
        if (!parent) return;
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(String(f.key));
      });
      var queue = [root];
      while (queue.length) {
        var k = queue.shift();
        (byParent.get(k) || []).forEach(function (child) {
          if (blocked.has(child)) return;
          blocked.add(child);
          queue.push(child);
        });
      }
      return blocked;
    }

    function populateFolderMoveSelect(movingKey, currentParentKey) {
      var select = $('folderMoveParent');
      if (!select) return;
      var folders = window.WORKSPACE_FOLDERS || [];
      var groups = window.FOLDER_TREE_GROUPS || [];
      var blocked = collectFolderDescendantKeys(movingKey, folders);
      blocked.add(String(movingKey || '').trim());
      select.innerHTML = '';

      var topOpt = document.createElement('option');
      topOpt.value = '';
      topOpt.textContent = 'Other folders (top-level)';
      select.appendChild(topOpt);

      groups.forEach(function (group) {
        var og = document.createElement('optgroup');
        og.label = String(group.name || 'Folders');
        if (group.isSystem && group.folderKey && !blocked.has(group.folderKey)) {
          var rootOpt = document.createElement('option');
          rootOpt.value = group.folderKey;
          rootOpt.textContent = group.folderName || group.name;
          og.appendChild(rootOpt);
        }
        (group.childRows || []).forEach(function (row) {
          if (!row.key || blocked.has(row.key)) return;
          var opt = document.createElement('option');
          opt.value = row.key;
          var prefix = row.depth > 1 ? '\u21b3 '.repeat(row.depth) : '\u21b3 ';
          opt.textContent = prefix + row.name;
          og.appendChild(opt);
        });
        if (og.children.length) select.appendChild(og);
      });

      var desired = String(currentParentKey || '').trim();
      select.value = desired;
      if (select.value !== desired && desired) {
        var fallback = document.createElement('option');
        fallback.value = desired;
        fallback.textContent = 'Current parent';
        select.insertBefore(fallback, select.firstChild.nextSibling);
        select.value = desired;
      }
    }

    function openFolderMoveModal(folderKey, folderName, currentParentKey) {
      var modal = $('folderMoveModal');
      if (!modal) return;
      if ($('folderMoveKey')) $('folderMoveKey').value = folderKey || '';
      if ($('folderMoveTitle')) $('folderMoveTitle').textContent = 'Move “' + (folderName || 'Folder') + '”';
      populateFolderMoveSelect(folderKey, currentParentKey);
      var err = $('folderMoveError');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      if ($('folderMoveParent')) $('folderMoveParent').focus();
    }

    function closeFolderMoveModal() {
      var modal = $('folderMoveModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if ($('folderMoveKey')) $('folderMoveKey').value = '';
    }

    function bindFolderMoveModal() {
      var modal = $('folderMoveModal');
      var bd = $('folderMoveBackdrop');
      var cancel = $('folderMoveCancel');
      var save = $('folderMoveSave');
      if (bd) bd.addEventListener('click', closeFolderMoveModal);
      if (cancel) cancel.addEventListener('click', closeFolderMoveModal);
      if (save) {
        save.addEventListener('click', function () {
          var key = ($('folderMoveKey') && $('folderMoveKey').value) || '';
          var parentKey = ($('folderMoveParent') && $('folderMoveParent').value) || '';
          var err = $('folderMoveError');
          if (!key) return;
          save.disabled = true;
          fetch('/folders/move', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ folderKey: key, parentFolderKey: parentKey })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Could not move folder.');
              }
              closeFolderMoveModal();
              window.location.reload();
            })
            .catch(function (e) {
              if (err) {
                err.textContent = e && e.message ? e.message : 'Could not move folder.';
                err.classList.remove('hidden');
              }
            })
            .finally(function () { save.disabled = false; });
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeFolderMoveModal();
      });
    }

    function selectedFolderMergeKeys() {
      return Array.prototype.slice
        .call(document.querySelectorAll('.folder-merge-checkbox:checked'))
        .map(function (cb) {
          return {
            key: cb.getAttribute('data-folder-key') || '',
            name: cb.getAttribute('data-folder-name') || 'Folder',
          };
        })
        .filter(function (x) {
          return !!x.key;
        });
    }

    function syncFolderMergeSelectedBtn() {
      var btn = $('folderMergeSelectedBtn');
      var label = $('folderMergeSelectedLabel');
      var selected = selectedFolderMergeKeys();
      if (!btn) return;
      btn.disabled = selected.length < 1;
      if (label) {
        label.textContent =
          selected.length > 1
            ? 'Merge ' + selected.length + ' folders'
            : selected.length === 1
              ? 'Merge folder'
              : 'Merge folders';
      }
    }

    function openFolderMergeModal(sourceItems, preferredTarget, opts) {
      var modal = $('folderMergeModal');
      var select = $('folderMergeTarget');
      if (!modal || !select) return;
      var sources = (sourceItems || []).filter(function (s) {
        return s && s.key;
      });
      if (!sources.length) return;
      var multiSelect = !!(opts && opts.multiSelect);
      if ($('folderMergeSources')) {
        $('folderMergeSources').value = sources
          .map(function (s) {
            return s.key;
          })
          .join('\n');
        $('folderMergeSources').setAttribute('data-multi-select', multiSelect ? '1' : '0');
      }
      var names = sources
        .map(function (s) {
          return s.name || 'Folder';
        })
        .join(', ');
      if ($('folderMergeTitle')) {
        $('folderMergeTitle').textContent =
          sources.length === 1 ? 'Merge “' + names + '”' : 'Merge ' + sources.length + ' folders';
      }
      if ($('folderMergeSubtitle')) {
        $('folderMergeSubtitle').textContent = multiSelect
          ? 'Pick which folder to keep. Leads from the other selected folders move there, then those folders are removed.'
          : 'Move all leads from ' + names + ' into the destination folder, then remove the source folder.';
      }

      var folders = window.WORKSPACE_FOLDERS || [];
      var sourceSet = new Set(
        sources.map(function (s) {
          return String(s.key);
        }),
      );
      select.innerHTML = '';
      folders.forEach(function (f) {
        if (!f || !f.key) return;
        if (!multiSelect && sourceSet.has(String(f.key))) return;
        if (multiSelect && !sourceSet.has(String(f.key))) return;
        var opt = document.createElement('option');
        opt.value = f.key;
        opt.textContent = f.name || 'Folder';
        select.appendChild(opt);
      });
      // Multi-select also allow merging into a folder outside the selection.
      if (multiSelect) {
        folders.forEach(function (f) {
          if (!f || !f.key || sourceSet.has(String(f.key))) return;
          var opt = document.createElement('option');
          opt.value = f.key;
          opt.textContent = (f.name || 'Folder') + ' (other)';
          select.appendChild(opt);
        });
      }
      var desired = String(preferredTarget || '').trim();
      if (desired) select.value = desired;
      if (!select.value && select.options.length) select.selectedIndex = 0;

      var err = $('folderMergeError');
      if (err) {
        err.classList.add('hidden');
        err.textContent = '';
      }
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      select.focus();
    }

    function closeFolderMergeModal() {
      var modal = $('folderMergeModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if ($('folderMergeSources')) $('folderMergeSources').value = '';
    }

    function bindFolderMergeUi() {
      var modal = $('folderMergeModal');
      var bd = $('folderMergeBackdrop');
      var cancel = $('folderMergeCancel');
      var save = $('folderMergeSave');
      var mergeSelectedBtn = $('folderMergeSelectedBtn');
      if (bd) bd.addEventListener('click', closeFolderMergeModal);
      if (cancel) cancel.addEventListener('click', closeFolderMergeModal);
      document.querySelectorAll('.folder-merge-checkbox').forEach(function (cb) {
        cb.addEventListener('click', function (e) {
          e.stopPropagation();
        });
        cb.addEventListener('change', syncFolderMergeSelectedBtn);
      });
      document.querySelectorAll('.folder-merge-into').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          var name = btn.getAttribute('data-folder-name') || 'Folder';
          if (!key) return;
          openFolderMergeModal([{ key: key, name: name }]);
        });
      });
      document.querySelectorAll('.folder-merge-duplicates').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var key = btn.getAttribute('data-folder-key') || '';
          var name = btn.getAttribute('data-folder-name') || 'this folder';
          if (!key || btn.disabled) return;
          btn.disabled = true;
          var original = btn.textContent;
          btn.textContent = 'Checking…';
          fetch('/leads/merge-duplicates', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ folderKey: key, dryRun: true, limit: 50 }),
          })
            .then(function (r) {
              return r.json().then(function (data) {
                return { ok: r.ok, data: data };
              });
            })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Could not scan duplicates.');
              }
              var found = Number(pack.data.groupsFound) || 0;
              if (!found) {
                window.alert('No duplicate groups found in “' + name + '”.');
                return null;
              }
              var sample = Array.isArray(pack.data.groups)
                ? pack.data.groups
                    .slice(0, 5)
                    .map(function (g) {
                      return '- ' + ((g.titles && g.titles.join(' / ')) || g.matchedOn || 'group') + ' (' + (g.count || '?') + ')';
                    })
                    .join('\n')
                : '';
              if (
                !window.confirm(
                  'Found ' +
                    found +
                    ' duplicate group' +
                    (found === 1 ? '' : 's') +
                    ' in “' +
                    name +
                    '”.\n\n' +
                    (sample ? sample + '\n\n' : '') +
                    'Merge each group into one lead? This cannot be undone.',
                )
              ) {
                return null;
              }
              btn.textContent = 'Merging…';
              return fetch('/leads/merge-duplicates', {
                method: 'POST',
                credentials: 'same-origin',
                headers: jsonHeaders,
                body: JSON.stringify({ folderKey: key, dryRun: false, limit: 50 }),
              }).then(function (r) {
                return r.json().then(function (data) {
                  return { ok: r.ok, data: data };
                });
              });
            })
            .then(function (pack) {
              if (!pack) return;
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Merge duplicates failed.');
              }
              var merged = Number(pack.data.groupsMerged) || 0;
              var away = Number(pack.data.leadsMergedAway) || 0;
              window.alert(
                merged
                  ? 'Merged ' + merged + ' group' + (merged === 1 ? '' : 's') + ' (' + away + ' leads removed).'
                  : 'No groups were merged.',
              );
              if (merged) window.location.reload();
            })
            .catch(function (err) {
              window.alert(err && err.message ? err.message : 'Merge duplicates failed.');
            })
            .finally(function () {
              btn.disabled = false;
              btn.textContent = original || 'Merge duplicates';
            });
        });
      });
      if (mergeSelectedBtn) {
        mergeSelectedBtn.addEventListener('click', function () {
          var selected = selectedFolderMergeKeys();
          if (!selected.length) return;
          if (selected.length === 1) {
            openFolderMergeModal(selected, '', { multiSelect: false });
            return;
          }
          openFolderMergeModal(selected, selected[0].key, { multiSelect: true });
        });
      }
      if (save) {
        save.addEventListener('click', function () {
          var sourcesRaw = ($('folderMergeSources') && $('folderMergeSources').value) || '';
          var selectedKeys = sourcesRaw
            .split(/\n+/)
            .map(function (s) {
              return String(s || '').trim();
            })
            .filter(Boolean);
          var multiSelect =
            ($('folderMergeSources') && $('folderMergeSources').getAttribute('data-multi-select')) === '1';
          var targetFolderKey = ($('folderMergeTarget') && $('folderMergeTarget').value) || '';
          var sourceFolderKeys = multiSelect
            ? selectedKeys.filter(function (k) {
                return k !== targetFolderKey;
              })
            : selectedKeys;
          var err = $('folderMergeError');
          if (!sourceFolderKeys.length || !targetFolderKey) {
            if (err) {
              err.textContent = multiSelect
                ? 'Select at least two folders, and pick which one to keep.'
                : 'Pick a destination folder.';
              err.classList.remove('hidden');
            }
            return;
          }
          if (
            !window.confirm(
              'Merge ' +
                sourceFolderKeys.length +
                ' folder' +
                (sourceFolderKeys.length === 1 ? '' : 's') +
                ' into the destination? Source folders will be removed after leads move.',
            )
          ) {
            return;
          }
          save.disabled = true;
          save.textContent = 'Merging…';
          fetch('/folders/merge', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({ targetFolderKey: targetFolderKey, sourceFolderKeys: sourceFolderKeys }),
          })
            .then(function (r) {
              return r.json().then(function (data) {
                return { ok: r.ok, data: data };
              });
            })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Could not merge folders.');
              }
              closeFolderMergeModal();
              window.location.reload();
            })
            .catch(function (e) {
              if (err) {
                err.textContent = e && e.message ? e.message : 'Could not merge folders.';
                err.classList.remove('hidden');
              }
            })
            .finally(function () {
              save.disabled = false;
              save.textContent = 'Merge folders';
            });
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeFolderMergeModal();
      });
      syncFolderMergeSelectedBtn();
    }

    function folderByKey(key) {
      var list = window.WORKSPACE_FOLDERS || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].key === key) return list[i];
      }
      return null;
    }

    function syncFolderSearchJobPanels() {
      var jt = ($('folderSearchJobType') && $('folderSearchJobType').value) || 'maps_business';
      var maps = $('folderSearchMapsFields');
      var listing = $('folderSearchListingFields');
      var reExtras = $('folderSearchReExtras');
      var isListing = jt === 'real_estate' || jt === 'products' || jt === 'wholesale';
      if (maps) maps.classList.toggle('hidden', jt !== 'maps_business');
      if (listing) listing.classList.toggle('hidden', !isListing);
      if (reExtras) reExtras.classList.toggle('hidden', jt !== 'real_estate');
      if (isListing) applyListingSourcesForJobType(jt);
    }

    function applyListingSourcesForJobType(jt) {
      var root = $('folderSearchListingFields');
      if (!root) return;
      var defaults = (window.FOLDER_DEFAULT_SOURCES && window.FOLDER_DEFAULT_SOURCES[jt]) || [];
      root.querySelectorAll('[data-listing-source]').forEach(function (cb) {
        var sid = cb.getAttribute('data-listing-source');
        cb.checked = !defaults.length || defaults.indexOf(sid) >= 0;
        var label = cb.closest('label');
        if (label) label.classList.toggle('hidden', defaults.length > 0 && defaults.indexOf(sid) < 0);
      });
    }

    function fillFolderSearchForm(preset, folder) {
      var p = preset || {};
      var jt = p.jobType || (folder && folder.jobType) || 'maps_business';
      if (
        jt === 'mobile_homes' ||
        jt === 'home_owners' ||
        (folder && folder.isPipelineDefault && String(folder.name || '').toLowerCase() === 'mobile homes') ||
        (folder && folder.isPipelineDefault && String(folder.name || '').toLowerCase() === 'home owners')
      ) {
        jt = 'real_estate';
      }
      if (['real_estate', 'products', 'wholesale'].indexOf(jt) < 0 && jt !== 'maps_business') {
        jt = 'maps_business';
      }

      if ($('folderSearchJobType')) $('folderSearchJobType').value = jt;
      if ($('folderSearchMaxResults')) $('folderSearchMaxResults').value = String(p.maxResults || 25);
      if ($('folderSearchCity')) $('folderSearchCity').value = p.city || '';
      if ($('folderSearchState')) $('folderSearchState').value = p.state || '';
      if ($('folderSearchKeyword')) $('folderSearchKeyword').value = p.keyword || p.query || (folder && folder.name) || '';
      if ($('folderSearchMapsProvider')) $('folderSearchMapsProvider').value = p.mapsProvider || 'auto';
      if ($('folderSearchMinRating')) $('folderSearchMinRating').value = p.minRating != null ? String(p.minRating) : '';
      if ($('folderSearchMinReviews')) $('folderSearchMinReviews').value = p.minReviews != null ? String(p.minReviews) : '';
      if ($('folderSearchAutoTags')) {
        $('folderSearchAutoTags').value = Array.isArray(p.autoTags) ? p.autoTags.join(', ') : (p.autoTags || '');
      }
      if ($('folderSearchSearchNotes')) $('folderSearchSearchNotes').value = p.searchNotes || '';
      if ($('folderSearchDirectorySupplement')) {
        $('folderSearchDirectorySupplement').checked = p.directorySupplement !== false;
      }
      if ($('folderSearchReScraper')) $('folderSearchReScraper').value = p.scraper || 'listings';
      if ($('folderSearchListingMarket')) $('folderSearchListingMarket').value = p.listingMarket || 'both';
      if ($('folderSearchQuery')) {
        var defaults = { real_estate: 'homes for sale and recently sold', products: '', wholesale: 'wholesale' };
        $('folderSearchQuery').value = p.query || defaults[jt] || '';
      }
      if ($('folderSearchMinPrice')) $('folderSearchMinPrice').value = p.minPrice != null ? String(p.minPrice) : '';
      if ($('folderSearchMaxPrice')) $('folderSearchMaxPrice').value = p.maxPrice != null ? String(p.maxPrice) : '';

      var ff = p.flipFilter || {};
      var flipOn = !!(ff && ff.enabled);
      if ($('folderSearchFlipEnabled')) $('folderSearchFlipEnabled').checked = flipOn;
      if ($('folderSearchFlipFields')) $('folderSearchFlipFields').classList.toggle('hidden', !flipOn);
      if ($('folderSearchMinFlipScore')) $('folderSearchMinFlipScore').value = String(ff.minFlipScore != null ? ff.minFlipScore : 7);
      if ($('folderSearchMinRoi')) $('folderSearchMinRoi').value = String(ff.minRoiPercent != null ? ff.minRoiPercent : 15);
      if ($('folderSearchLandMode')) $('folderSearchLandMode').value = ff.landMode || 'prefer_own_land';
      if ($('folderSearchRequireOwnLand')) $('folderSearchRequireOwnLand').checked = !!ff.requireOwnLand;
      if ($('folderSearchExcludePark')) $('folderSearchExcludePark').checked = ff.excludeParkRent !== false;

      var listingRoot = $('folderSearchListingFields');
      if (listingRoot && p.sources) applyListingSources(listingRoot, p.sources);

      syncFolderSearchJobPanels();
    }

    function applyListingSources(root, sourceIds) {
      if (!root) return;
      var ids = Array.isArray(sourceIds) ? sourceIds : [];
      root.querySelectorAll('[data-listing-source]').forEach(function (cb) {
        var sid = cb.getAttribute('data-listing-source');
        cb.checked = !ids.length || ids.indexOf(sid) >= 0;
      });
    }

    function openFolderSearchSetup(folderKey) {
      var modal = $('folderSearchSetupModal');
      var folder = folderByKey(folderKey);
      if (!modal || !folder) return;
      if ($('folderSearchSetupKey')) $('folderSearchSetupKey').value = folderKey;
      var infoPackLink = $('folderSearchInfoPackLink');
      if (infoPackLink) {
        infoPackLink.href = '/workspace/info-packs?folder=' + encodeURIComponent(folderKey);
      }
      if ($('folderSearchSetupSubtitle')) {
        $('folderSearchSetupSubtitle').textContent = 'Configure search for "' + (folder.name || 'folder') + '". Run search replays these settings and merges new leads into this folder.';
      }
      fillFolderSearchForm(folder.searchPreset, folder);
      var err = $('folderSearchSetupError');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeFolderSearchSetup() {
      var modal = $('folderSearchSetupModal');
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    function buildFolderSearchPayload() {
      var key = ($('folderSearchSetupKey') && $('folderSearchSetupKey').value) || '';
      var jt = ($('folderSearchJobType') && $('folderSearchJobType').value) || 'maps_business';
      var body = {
        folderKey: key,
        jobType: jt,
        maxResults: parseInt(($('folderSearchMaxResults') && $('folderSearchMaxResults').value) || '25', 10) || 25,
        city: ($('folderSearchCity') && $('folderSearchCity').value) || '',
        state: ($('folderSearchState') && $('folderSearchState').value) || '',
      };
      var isListing = jt === 'real_estate' || jt === 'products' || jt === 'wholesale';
      if (isListing) {
        body.query = ($('folderSearchQuery') && $('folderSearchQuery').value) || '';
        body.minPrice = ($('folderSearchMinPrice') && $('folderSearchMinPrice').value) || '';
        body.maxPrice = ($('folderSearchMaxPrice') && $('folderSearchMaxPrice').value) || '';
        var listingRoot = $('folderSearchListingFields');
        if (listingRoot) {
          listingRoot.querySelectorAll('[data-listing-source]').forEach(function (cb) {
            var sid = cb.getAttribute('data-listing-source');
            if (cb.checked && sid) body['source_' + sid] = 'on';
          });
        }
        if (jt === 'real_estate') {
          body.scraper = ($('folderSearchReScraper') && $('folderSearchReScraper').value) || 'listings';
          body.listingMarket = ($('folderSearchListingMarket') && $('folderSearchListingMarket').value) || 'both';
          if ($('folderSearchFlipEnabled') && $('folderSearchFlipEnabled').checked) {
            body.flipFilterEnabled = 'on';
            body.minFlipScore = ($('folderSearchMinFlipScore') && $('folderSearchMinFlipScore').value) || '7';
            body.minRoiPercent = ($('folderSearchMinRoi') && $('folderSearchMinRoi').value) || '15';
            body.flipLandMode = ($('folderSearchLandMode') && $('folderSearchLandMode').value) || 'prefer_own_land';
            if ($('folderSearchRequireOwnLand') && $('folderSearchRequireOwnLand').checked) body.flipRequireOwnLand = 'on';
            if ($('folderSearchExcludePark') && $('folderSearchExcludePark').checked) body.flipExcludePark = 'on';
          }
        }
      } else {
        body.keyword = ($('folderSearchKeyword') && $('folderSearchKeyword').value) || 'plumber';
        body.mapsProvider = ($('folderSearchMapsProvider') && $('folderSearchMapsProvider').value) || 'auto';
        body.minRating = ($('folderSearchMinRating') && $('folderSearchMinRating').value) || '';
        body.minReviews = ($('folderSearchMinReviews') && $('folderSearchMinReviews').value) || '';
        body.autoTags = ($('folderSearchAutoTags') && $('folderSearchAutoTags').value) || '';
        body.searchNotes = ($('folderSearchSearchNotes') && $('folderSearchSearchNotes').value) || '';
        if ($('folderSearchDirectorySupplement') && $('folderSearchDirectorySupplement').checked) {
          body.directorySupplement = 'on';
        }
      }
      return body;
    }

    function bindFolderSearchSetupModal() {
      var modal = $('folderSearchSetupModal');
      var bd = $('folderSearchSetupBackdrop');
      var cancel = $('folderSearchSetupCancel');
      var save = $('folderSearchSetupSave');
      var jobSel = $('folderSearchJobType');
      var flipCb = $('folderSearchFlipEnabled');
      var err = $('folderSearchSetupError');

      if (jobSel) jobSel.addEventListener('change', syncFolderSearchJobPanels);
      if (flipCb) {
        flipCb.addEventListener('change', function () {
          if ($('folderSearchFlipFields')) {
            $('folderSearchFlipFields').classList.toggle('hidden', !flipCb.checked);
          }
        });
      }
      if (bd) bd.addEventListener('click', closeFolderSearchSetup);
      if (cancel) cancel.addEventListener('click', closeFolderSearchSetup);
      if (save) {
        save.addEventListener('click', function () {
          var body = buildFolderSearchPayload();
          if (!body.folderKey) return;
          fetch('/folders/save-search-preset', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify(body),
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Could not save search setup.');
              }
              closeFolderSearchSetup();
              window.location.reload();
            })
            .catch(function (e) {
              if (err) {
                err.textContent = e && e.message ? e.message : 'Could not save search setup.';
                err.classList.remove('hidden');
              }
            });
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') closeFolderSearchSetup();
      });
    }

    function bindFolderCreateModal() {
      var m = $('folderCreateModal');
      var openBtn = $('folderCreateOpen');
      var bd = $('folderCreateBackdrop');
      var cancel = $('folderCreateCancel');
      var save = $('folderCreateSave');
      var nameIn = $('folderCreateName');
      var err = $('folderCreateError');

      function openM() {
        if (!m) return;
        m.style.display = 'flex';
        m.setAttribute('aria-hidden', 'false');
        if (nameIn) {
          nameIn.value = '';
          nameIn.focus();
        }
        if (err) { err.classList.add('hidden'); err.textContent = ''; }
      }
      function closeM() {
        if (!m) return;
        m.style.display = 'none';
        m.setAttribute('aria-hidden', 'true');
        if (nameIn) nameIn.value = '';
      }

      if (openBtn) openBtn.addEventListener('click', function (e) { e.preventDefault(); openM(); });
      if (bd) bd.addEventListener('click', closeM);
      if (cancel) cancel.addEventListener('click', closeM);
      if (save) {
        save.addEventListener('click', function () {
          var n = (nameIn && nameIn.value || '').trim();
          if (!n) {
            if (err) { err.textContent = 'Enter a folder name.'; err.classList.remove('hidden'); }
            return;
          }
          fetch('/folders', {
            method: 'POST',
            credentials: 'same-origin',
            headers: jsonHeaders,
            body: JSON.stringify({
              name: n,
              parentFolderKey: ($('folderCreateParent') && $('folderCreateParent').value) || '',
              jobType: (function () {
                var sel = $('folderCreateParent');
                if (!sel || !sel.value) return '';
                var opt = sel.options[sel.selectedIndex];
                return opt && opt.getAttribute('data-job-type') ? opt.getAttribute('data-job-type') : '';
              })()
            })
          })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (pack) {
              if (!pack.ok || !pack.data || !pack.data.success) {
                throw new Error((pack.data && pack.data.error) || 'Could not create folder.');
              }
              closeM();
              var createdKey = pack.data.folder && pack.data.folder.key ? String(pack.data.folder.key) : '';
              var nextUrl = '/prospecting?tab=folders';
              if (createdKey) nextUrl += '&folderCreated=' + encodeURIComponent(createdKey);
              window.location.href = nextUrl;
            })
            .catch(function (e) {
              if (err) { err.textContent = e && e.message ? e.message : 'Could not create folder.'; err.classList.remove('hidden'); }
            });
        });
      }
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && m && m.style.display === 'flex') closeM();
      });
    }

    function bindFolderTreeToggle() {
      document.querySelectorAll('.folder-tree-expand').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var node = btn.closest('[data-folder-tree-node]');
          var children = node && node.querySelector(':scope > [data-folder-tree-children]');
          if (!children) return;
          children.classList.toggle('hidden');
          var isOpen = !children.classList.contains('hidden');
          btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          btn.textContent = isOpen ? '\u25BC' : '\u25B6';
        });
      });
    }

    function revealFolderTreeAncestors(node) {
      while (node) {
        node.classList.remove('hidden');
        var parentList = node.parentElement;
        if (!parentList || !parentList.hasAttribute('data-folder-tree-children')) break;
        parentList.classList.remove('hidden');
        var parentNode = parentList.closest('[data-folder-tree-node]');
        if (parentNode) {
          var btn = parentNode.querySelector(':scope > div > .folder-tree-expand');
          if (btn) {
            btn.textContent = '\u25BC';
            btn.setAttribute('aria-expanded', 'true');
          }
          node = parentNode;
        } else {
          break;
        }
      }
    }

    function highlightCreatedFolder() {
      var params = new URLSearchParams(window.location.search);
      var key = String(params.get('folderCreated') || '').trim();
      if (!key) return;
      var row = document.querySelector('[data-folder-row="' + (window.CSS && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\\"')) + '"]');
      if (!row) return;
      var group = row.closest('.folder-group');
      if (group) group.open = true;
      revealFolderTreeAncestors(row.closest('[data-folder-tree-node]'));
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      row.classList.add('ring-2', 'ring-brand-yellow/70', 'rounded-xl');
      setTimeout(function () {
        row.classList.remove('ring-2', 'ring-brand-yellow/70', 'rounded-xl');
      }, 3200);
      params.delete('folderCreated');
      var qs = params.toString();
      history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }

    function expandGroupsWithCustomSubfolders() {
      document.querySelectorAll('.folder-group').forEach(function (group) {
        var hasCustom = !!group.querySelector('.folder-row[data-folder-is-default="0"][data-folder-is-trade="0"]');
        if (hasCustom) group.open = true;
      });
      document.querySelectorAll('[data-folder-tree-node]').forEach(function (node) {
        var hasCustom = !!node.querySelector(':scope > [data-folder-tree-children] .folder-row[data-folder-is-trade="0"][data-folder-is-default="0"]');
        if (!hasCustom) return;
        var children = node.querySelector(':scope > [data-folder-tree-children]');
        var btn = node.querySelector(':scope > div > .folder-tree-expand');
        if (children) children.classList.remove('hidden');
        if (btn) {
          btn.textContent = '\u25BC';
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    function parseFolderLeadCount(node) {
      var n = parseInt(node.getAttribute('data-folder-lead-count') || '0', 10);
      return Number.isFinite(n) ? n : 0;
    }

    var FOLDER_SORT_STORAGE_KEY = 'adhello.folderManager.sortMode';

    function getFolderSortMode() {
      try {
        var m = String(localStorage.getItem(FOLDER_SORT_STORAGE_KEY) || '').trim().toLowerCase();
        if (m === 'leads' || m === 'name') return m;
      } catch (_) {}
      return 'name';
    }

    function setFolderSortMode(mode) {
      var next = mode === 'leads' ? 'leads' : 'name';
      try {
        localStorage.setItem(FOLDER_SORT_STORAGE_KEY, next);
      } catch (_) {}
      return next;
    }

    function updateFolderOrganizeButton(mode) {
      var btn = $('folderOrganizeByLeadsBtn');
      var label = $('folderOrganizeByLeadsLabel');
      if (!btn) return;
      var isLeads = mode === 'leads';
      btn.dataset.sortMode = isLeads ? 'leads' : 'name';
      btn.setAttribute('aria-pressed', isLeads ? 'true' : 'false');
      btn.classList.toggle('border-brand-yellow', isLeads);
      btn.classList.toggle('bg-brand-yellow/15', isLeads);
      if (label) label.textContent = isLeads ? 'Sort A–Z' : 'Organize by leads';
      btn.title = isLeads
        ? 'Currently sorted by lead count — click to sort folders A–Z'
        : 'Sort folders with leads to the top and empty folders to the bottom';
    }

    function setFolderOrganizeStatus(msg) {
      var el = $('folderOrganizeStatus');
      if (el) el.textContent = msg || '';
      if (typeof window.showAppToast === 'function' && msg) {
        window.showAppToast(msg, { variant: 'success' });
      }
    }

    function sortFolderTreeChildrenList(ul, mode) {
      if (!ul) return;
      var sortMode = mode === 'leads' ? 'leads' : 'name';
      var items = Array.from(ul.children).filter(function (el) {
        return el && el.classList && el.classList.contains('folder-tree-node');
      });
      if (items.length < 2) return;
      items.sort(function (a, b) {
        if (sortMode === 'leads') {
          var ca = parseFolderLeadCount(a);
          var cb = parseFolderLeadCount(b);
          var ae = ca > 0 ? 0 : 1;
          var be = cb > 0 ? 0 : 1;
          if (ae !== be) return ae - be;
          if (cb !== ca) return cb - ca;
        }
        var na = (a.getAttribute('data-folder-tree-search') || '').trim();
        var nb = (b.getAttribute('data-folder-tree-search') || '').trim();
        return na.localeCompare(nb);
      });
      items.forEach(function (li) { ul.appendChild(li); });
      items.forEach(function (li) {
        var nested = null;
        for (var i = 0; i < li.children.length; i += 1) {
          if (li.children[i].hasAttribute && li.children[i].hasAttribute('data-folder-tree-children')) {
            nested = li.children[i];
            break;
          }
        }
        if (nested) sortFolderTreeChildrenList(nested, sortMode);
      });
    }

    function organizeFolderManagerByLeads(mode) {
      var root = document.getElementById('folderTreeRoot');
      if (!root) return;
      var sortMode = mode === 'leads' ? 'leads' : 'name';
      var groups = Array.from(root.children).filter(function (el) {
        return el && el.matches && el.matches('details.folder-group');
      });
      groups.sort(function (a, b) {
        if (sortMode === 'leads') {
          var ca = parseInt(a.getAttribute('data-folder-group-leads') || '0', 10) || 0;
          var cb = parseInt(b.getAttribute('data-folder-group-leads') || '0', 10) || 0;
          var ae = ca > 0 ? 0 : 1;
          var be = cb > 0 ? 0 : 1;
          if (ae !== be) return ae - be;
          if (cb !== ca) return cb - ca;
        }
        return (a.getAttribute('data-folder-group-search') || '').localeCompare(
          b.getAttribute('data-folder-group-search') || '',
        );
      });
      groups.forEach(function (g) { root.appendChild(g); });
      groups.forEach(function (g) {
        var ul = g.querySelector(':scope > ul');
        if (ul) sortFolderTreeChildrenList(ul, sortMode);
      });
      root.querySelectorAll('[data-folder-tree-children]').forEach(function (nested) {
        sortFolderTreeChildrenList(nested, sortMode);
      });
    }

    function applyFolderSortMode(mode, announce) {
      var next = setFolderSortMode(mode);
      organizeFolderManagerByLeads(next);
      updateFolderOrganizeButton(next);
      if (announce) {
        setFolderOrganizeStatus(
          next === 'leads'
            ? 'Folders organized by lead count (leads first).'
            : 'Folders sorted A–Z.',
        );
      }
    }

    function bindFolderOrganizeByLeads() {
      var btn = $('folderOrganizeByLeadsBtn');
      if (!btn || btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      var initial = getFolderSortMode();
      applyFolderSortMode(initial, false);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var current = btn.dataset.sortMode === 'leads' ? 'leads' : 'name';
        applyFolderSortMode(current === 'leads' ? 'name' : 'leads', true);
      });
    }

    function bindFolderSearchFilter() {
      var input = $('folderSearchFilter');
      var empty = $('folderSearchEmpty');
      if (!input) return;

      function collapseAllTreeBranches() {
        document.querySelectorAll('[data-folder-tree-children]').forEach(function (el) {
          el.classList.add('hidden');
        });
        document.querySelectorAll('.folder-tree-expand').forEach(function (btn) {
          btn.textContent = '\u25B6';
          btn.setAttribute('aria-expanded', 'false');
        });
      }

      function applyFilter() {
        var q = String(input.value || '').trim().toLowerCase();
        var anyVisible = false;
        document.querySelectorAll('.folder-group').forEach(function (group) {
          var groupMatch = !q || String(group.getAttribute('data-folder-group-search') || '').indexOf(q) >= 0;
          var visibleNodes = new Set();

          if (!q) {
            group.querySelectorAll('[data-folder-tree-node]').forEach(function (node) {
              node.classList.remove('hidden');
            });
            collapseAllTreeBranches();
          } else {
            group.querySelectorAll('.folder-row').forEach(function (row) {
              if (String(row.getAttribute('data-folder-search') || '').indexOf(q) < 0) return;
              var n = row.closest('[data-folder-tree-node]');
              while (n && group.contains(n)) {
                visibleNodes.add(n);
                var parentList = n.parentElement;
                if (!parentList || !parentList.hasAttribute('data-folder-tree-children')) break;
                n = parentList.closest('[data-folder-tree-node]');
              }
            });
            group.querySelectorAll('[data-folder-tree-node]').forEach(function (node) {
              var show = groupMatch || visibleNodes.has(node);
              node.classList.toggle('hidden', !show);
              if (show && visibleNodes.has(node)) revealFolderTreeAncestors(node);
            });
          }

          var showGroup = !q || groupMatch || visibleNodes.size > 0;
          group.classList.toggle('hidden', !showGroup);
          if (showGroup) anyVisible = true;
          if (q && showGroup && visibleNodes.size > 0) group.open = true;
        });
        if (empty) empty.classList.toggle('hidden', !q || anyVisible);
      }
      input.addEventListener('input', applyFilter);
    }

    function init() {
      bindFolderManager();
      bindFolderTreeToggle();
      bindFolderCreateModal();
      bindFolderMoveModal();
      bindFolderMergeUi();
      bindFolderOutreachModal();
      bindFolderSearchSetupModal();
      bindFolderSearchFilter();
      bindFolderOrganizeByLeads();
      expandGroupsWithCustomSubfolders();
      highlightCreatedFolder();
    }
    window.__adhelloInitFolderManager = init;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
