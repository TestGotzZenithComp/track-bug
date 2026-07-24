'use strict';

/* Polling controller for GitHub Actions deployment status.

   Same contract as the React hook it stands in for — create once, then
   start()/stop() as the panel becomes visible. Cadence is re-decided after
   every response, so a run that finishes drops itself back to the idle
   interval without any caller involvement.

   Usage:
     const poller = createGithubDeployment(state => Card.render(state));
     poller.start();   // fetches immediately, then keeps itself scheduled
     poller.stop();    // clears the timer and aborts any in-flight request
*/
(function () {
  const ENDPOINT = '/api/github-actions';
  const RUNNING_INTERVAL = 5000;
  const IDLE_INTERVAL = 60000;

  function createGithubDeployment(onState) {
    let timer = null;
    let controller = null;
    let active = false;
    let generation = 0; // bumped on start/stop so late responses can't paint

    function schedule(ms) {
      clearTimeout(timer);
      if (!active) return;
      timer = setTimeout(tick, ms);
    }

    async function tick() {
      const gen = generation;
      controller = new AbortController();

      try {
        const res = await fetch(ENDPOINT, { signal: controller.signal });
        const json = await res.json().catch(() => ({}));
        if (!active || gen !== generation) return;

        if (!res.ok) throw new Error(json.detail || json.error || res.statusText);

        onState({ status: 'success', data: json, error: null });
        schedule(json.running ? RUNNING_INTERVAL : IDLE_INTERVAL);
      } catch (err) {
        if (err.name === 'AbortError' || !active || gen !== generation) return;
        onState({ status: 'error', data: null, error: err.message });
        schedule(IDLE_INTERVAL);
      }
    }

    return {
      start() {
        if (active) return;
        active = true;
        generation++;
        onState({ status: 'loading', data: null, error: null });
        tick();
      },

      stop() {
        if (!active) return;
        active = false;
        generation++;
        clearTimeout(timer);
        timer = null;
        if (controller) controller.abort();
        controller = null;
      },
    };
  }

  window.createGithubDeployment = createGithubDeployment;
})();
