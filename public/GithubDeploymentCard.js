'use strict';

/* GitHub deployment card — renders the state emitted by createGithubDeployment().

   Owns a 1s ticker so the "Elapsed" counter advances smoothly between the
   5s polls; the ticker is torn down on every re-render and on destroy().

   Usage:
     GithubDeploymentCard.mount(document.getElementById('github-panel'));
     GithubDeploymentCard.render(state);
     GithubDeploymentCard.destroy();
*/
(function () {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const STATUS_META = {
    queued:      { icon: '🟡', label: 'Waiting',   color: '#eab308' },
    waiting:     { icon: '🟡', label: 'Waiting',   color: '#eab308' },
    pending:     { icon: '🟡', label: 'Waiting',   color: '#eab308' },
    requested:   { icon: '🟡', label: 'Waiting',   color: '#eab308' },
    in_progress: { icon: '🔵', label: 'Deploying', color: '#3b82f6' },
    success:     { icon: '🟢', label: 'Success',   color: '#22c55e' },
    failure:     { icon: '🔴', label: 'Failed',    color: '#ef4444' },
    cancelled:   { icon: '⚪', label: 'Cancelled', color: '#9ca3af' },
  };
  const UNKNOWN = { icon: '⚪', label: 'Unknown', color: '#6b7280' };

  let host = null;
  let ticker = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const pad = n => String(n).padStart(2, '0');

  /* A run still in flight is described by `status`; a finished one by `conclusion`. */
  function metaFor(run) {
    if (!run) return UNKNOWN;
    if (run.status && run.status !== 'completed') {
      return STATUS_META[run.status] || STATUS_META.in_progress;
    }
    return STATUS_META[run.conclusion] || UNKNOWN;
  }

  function formatDateTime(iso) {          // 23 Jul 2026 18:42
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatClock(iso) {             // 18:45
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDuration(sec) {          // 2m 06s
    if (sec == null || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m ? `${m}m ${pad(s)}s` : `${s}s`;
  }

  function formatElapsed(sec) {           // 00:01:32
    const t = Math.max(0, Math.floor(sec));
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(pad).join(':');
  }

  function row(label, value) {
    return `<div class="gh-row"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function statusLine(meta, suffix) {
    return `<div class="gh-status" style="color:${meta.color}">${meta.icon} ${esc(meta.label)}${suffix || ''}</div>`;
  }

  /* ── Views ── */

  function skeletonView() {
    const bar = w => `<div class="gh-sk" style="width:${w}"></div>`;
    return `
      <div class="gh-card">
        <div class="gh-head"><span class="gh-title">GitHub Deployment</span></div>
        <div class="gh-body">
          <section class="gh-block">
            ${bar('55%')}${bar('35%')}${bar('70%')}${bar('60%')}
          </section>
          <section class="gh-block">
            ${bar('45%')}${bar('40%')}${bar('65%')}
          </section>
        </div>
      </div>`;
  }

  function errorView() {
    return `
      <div class="gh-card">
        <div class="gh-head"><span class="gh-title">GitHub Deployment</span></div>
        <div class="gh-error">⚠ Unable to retrieve GitHub Actions status.</div>
      </div>`;
  }

  function latestBlock(latest) {
    if (!latest) {
      return `
        <section class="gh-block">
          <div class="gh-block-label">Latest Successful Build</div>
          <div class="gh-empty">No successful deployment yet.</div>
        </section>`;
    }

    const meta = metaFor(latest);
    return `
      <section class="gh-block">
        <div class="gh-block-label">Latest Successful Build</div>
        ${statusLine(meta)}
        <dl class="gh-meta">
          ${row('Run', `#${latest.runNumber}`)}
          ${row('Branch', latest.branch || '—')}
          ${row('Commit', latest.commit || '—')}
          ${row('By', latest.actor || '—')}
          ${row('Completed', formatDateTime(latest.completedAt))}
          ${row('Duration', formatDuration(latest.durationSeconds))}
        </dl>
      </section>`;
  }

  function runningBlock(running) {
    if (!running) {
      return `
        <section class="gh-block">
          <div class="gh-block-label">Current Build</div>
          <div class="gh-empty">No deployment in progress.</div>
        </section>`;
    }

    const meta = metaFor(running);
    const suffix = meta.label === 'Deploying' ? '…' : '';
    return `
      <section class="gh-block gh-block-live">
        <div class="gh-block-label">Current Build</div>
        ${statusLine(meta, suffix)}
        <dl class="gh-meta">
          ${row('Run', `#${running.runNumber}`)}
          ${row('Started', formatClock(running.startedAt))}
          <div class="gh-row"><dt>Elapsed</dt><dd id="gh-elapsed">00:00:00</dd></div>
        </dl>
      </section>`;
  }

  function cardView(latest, running) {
    const workflowUrl = (running && running.url) || (latest && latest.url) || '';
    const link = workflowUrl
      ? `<a class="gh-link" href="${esc(workflowUrl)}" target="_blank" rel="noopener">View Workflow ↗</a>`
      : '';

    return `
      <div class="gh-card">
        <div class="gh-head">
          <span class="gh-title">GitHub Deployment</span>
          ${link}
        </div>
        <div class="gh-body">
          ${latestBlock(latest)}
          ${runningBlock(running)}
        </div>
      </div>`;
  }

  /* ── Elapsed ticker ── */

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function startTicker(startedAt) {
    const started = new Date(startedAt).getTime();
    const el = host && host.querySelector('#gh-elapsed');
    if (!el || Number.isNaN(started)) return;

    const paint = () => { el.textContent = formatElapsed((Date.now() - started) / 1000); };
    paint();
    ticker = setInterval(paint, 1000);
  }

  /* ── Public API ── */

  window.GithubDeploymentCard = {
    mount(el) { host = el; },

    render(state) {
      if (!host) return;
      stopTicker();

      if (state.status === 'loading') { host.innerHTML = skeletonView(); return; }
      if (state.status === 'error')   { host.innerHTML = errorView(); return; }

      const { latestSuccess, running } = state.data || {};
      host.innerHTML = cardView(latestSuccess, running);

      if (running && running.startedAt) startTicker(running.startedAt);
    },

    destroy() {
      stopTicker();
      if (host) host.innerHTML = '';
    },
  };
})();
