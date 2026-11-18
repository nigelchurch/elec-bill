// Moving between screens, arranged so Android's Back button behaves like a
// normal app's:
//   - From Bill, History or Data, Back goes to Daily.
//   - From Daily, Back closes the app.
//   - Editing a day from History: Back returns to History.
//
// The browser keeps a history list of the pages visited, and Back steps through
// it. Normally every screen change would add an entry, so Back would replay
// every screen you'd been on. Instead the list is kept short:
//   [Daily]                         depth 0
//   [Daily, other screen]           depth 1 (moving between screens replaces this entry)
//   [Daily, History, Daily edit]    depth 2
// Each entry remembers its depth (history.state), so we always know how far
// it is back to Daily.

const depth = () => history.state?.depth ?? 0;
const screenOf = (hash) => hash.slice(1).split('?')[0] || 'daily';

// Go to a screen, e.g. navigate('#bill').
// edit: true when opening a day from History (Back must return to History).
export function navigate(hash, { edit = false } = {}) {
  if (hash === location.hash) return;
  const d = depth();
  if (edit) {
    history.pushState({ depth: d + 1 }, '', hash);
  } else if (screenOf(hash) === 'daily' && !hash.includes('?')) {
    // Daily is always the bottom entry: go back to it rather than adding one.
    if (d > 0) { history.go(-d); return; } // the browser then fires 'hashchange'
    history.replaceState({ depth: 0 }, '', hash);
  } else if (d === 0) {
    history.pushState({ depth: 1 }, '', hash);
  } else {
    history.replaceState({ depth: d }, '', hash);
  }
  // pushState/replaceState change the address quietly; tell the app to redraw.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// At start-up: mark the first entry as the bottom of the list, and make every
// '#...' link (top bar, and links inside screens) go through navigate().
export function initNav() {
  if (history.state?.depth === undefined) history.replaceState({ depth: 0 }, '', location.hash || '#daily');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
}
