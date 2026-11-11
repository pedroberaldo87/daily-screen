if ('serviceWorker' in navigator) {
  // The wall tablet keeps the tab open 24/7, so a new SW never takes over
  // on its own. Reload once a fresh SW activates so the device picks up the
  // latest shell, and nudge an update check on load. Only reload when a
  // controller already existed (a real update) — a first-ever install also
  // fires controllerchange via clients.claim and needs no reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadingForSW = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForSW || !hadController) return;
    reloadingForSW = true;
    location.reload();
  });
  navigator.serviceWorker.register('/public/sw.js').then((reg) => {
    reg.update();
    // The tablet stays open 24/7 and never navigates, so the browser rarely
    // re-checks the SW on its own. Poll for updates so new versions roll out
    // automatically (then controllerchange reloads once) — no manual reload.
    setInterval(() => reg.update(), 30 * 60 * 1000);
  });
}
