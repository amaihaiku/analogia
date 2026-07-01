/** 
 * utils.js 
 * Általános segédfüggvények, UI üzenetek (toast) és diagnosztika.
 */
import { Store } from './state.js';

// --- Diagnosztika ---
export function renderDiag() {
  if (!Store.diagEl) {
    Store.diagEl = document.createElement('div');
    Store.diagEl.style.cssText = 'position:fixed;left:4px;right:4px;bottom:4px;max-height:36vh;overflow:auto;z-index:99999;background:rgba(0,0,0,.88);color:#7CFC00;font:10px/1.5 monospace;padding:6px;border:1px solid #555;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(Store.diagEl);
  }
  Store.diagEl.textContent = Store.diagBuf.join('\n') + '\n';
  Store.diagEl.scrollTop = Store.diagEl.scrollHeight;
}

export function dlog(msg) {
  Store.diagBuf.push('[' + (performance.now() / 1000).toFixed(1) + '] ' + msg);
  if (Store.diagBuf.length > 250) Store.diagBuf.shift();
  try { console.log('[DIAG]', msg); } catch (_) {}
  if (Store.DIAG) renderDiag();
}

export function toggleDiag() {
  Store.DIAG = !Store.DIAG;
  if (Store.DIAG) { 
    renderDiag(); 
    showToast('Diagnosztika BE'); 
  } else if (Store.diagEl) { 
    Store.diagEl.remove(); 
    Store.diagEl = null; 
    showToast('Diagnosztika KI'); 
  }
}

// Hibafigyelők inicializálása (ezt majd a main.js hívja meg)
export function initDiagnostics() {
  window.addEventListener('error', e => dlog('JS HIBA: ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => dlog('PROMISE HIBA: ' + ((e.reason && e.reason.message) || e.reason)));
}

// --- UI Értesítések ---
export function showToast(msg) {
  let t = document.getElementById('anal-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'anal-toast';
    t.style = "position:fixed;bottom:140px;left:50%;transform:translateX(-50%);background:rgba(20,18,16,0.92);border:1px solid var(--gold);color:var(--gold);font-family:var(--font);font-size:10px;letter-spacing:0.1em;padding:8px 16px;border-radius:4px;z-index:99999;transition:opacity 0.3s ease;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.5);";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t.to);
  t.to = setTimeout(() => { t.style.opacity = '0'; }, 1800);
}

// --- Matematikai és egyéb segédek ---

// Clamp függvény: [0, 1] közé szorítja az értéket
export function cl(v) {
  return Math.max(0, Math.min(1, v));
}

// Kép betöltő Promise (a keretekhez és textúrákhoz)
export function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}