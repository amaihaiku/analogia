/**
 * main.js
 * A PWA fő belépési pontja. Modulok összekötése és globális eseménykezelők.
 */
import { S, Store, PROF, Elements, CAPTURE_RES, PREVIEW_RES } from './state.js';
import { initDiagnostics, dlog, showToast, toggleDiag } from './utils.js';
import { loadExternalFilters } from './filters.js';
import { initGL, uploadLUT, markUniformsDirty, updateCanvasDimensions, render, gl } from './webgl.js';
import { listVideoDevices, initCam, cycleCamera, torchOff, setTorchArmed, torchArmed, setStreamResolution } from './camera.js';
import { capture, setSavingIndicator } from './capture.js';
import { buildDial, syncDial, updateFocusUI, getSelectedFrame, updateLiveDate, updateFocusLabel, setV, syncDateToggleAvailability } from './ui.js';

let armPromise = null;

function checkStandaloneGuard() {
  const urlParams = new URLSearchParams(window.location.search);
  const isPwaParam = urlParams.get('mode') === 'standalone' || urlParams.get('debug') === '1';
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone || isPwaParam;
  const overlay = document.getElementById('install-overlay');
  const shell = document.querySelector('.shell');
  
  if (isStandalone) {
    if (overlay) overlay.classList.add('hidden');
    if (shell) shell.style.display = 'flex';
  } else {
    if (shell) shell.style.display = 'none';
    if (overlay) overlay.classList.remove('hidden');
  }
}

// PWA Telepítés
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  Store.deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
  Store.deferredPrompt = null;
  const desc = document.querySelector('.install-desc');
  const actions = document.querySelector('.install-actions');
  if (desc) desc.innerHTML = "<span style='color: #c8a84b; font-weight: bold; display: block; margin-bottom: 8px;'>✓ SIKERES TELEPÍTÉS!</span>Ezt a lapot most már bezárhatod, and indíthatod az appot a kezdőképernyőről.";
  if (actions) actions.style.display = 'none';
  setTimeout(() => { window.close(); }, 1500);
});

// UI Modálok és Gombok
const filmBtn = document.getElementById('film-btn');
const modalClose = document.getElementById('modal-close');
const modalBackdrop = document.getElementById('modal-backdrop');

function buildFilmList() {
  const list = document.getElementById('film-list'); 
  if (!list) return;
  list.innerHTML = '';
  for (const [k, p] of Object.entries(PROF)) {
    const it = document.createElement('div');
    it.className = 'film-item' + (S.simKey === k ? ' active' : '');
    it.innerHTML = `<div class="film-dot"></div><div><div class="film-name">${p.name}</div><div class="film-sub">${p.sub}</div></div>`;
    it.onclick = () => {
      S.simKey = k;
      uploadLUT(p.lut);
      markUniformsDirty();
      const lbl = document.getElementById('film-label');
      if (lbl) lbl.textContent = p.name;
      document.getElementById('film-modal')?.classList.add('hidden');
    };
    list.appendChild(it);
  }
}

filmBtn?.addEventListener('click', () => { buildFilmList(); document.getElementById('film-modal')?.classList.remove('hidden'); });
modalClose?.addEventListener('click', () => document.getElementById('film-modal')?.classList.add('hidden'));
modalBackdrop?.addEventListener('click', () => document.getElementById('film-modal')?.classList.add('hidden'));

document.getElementById('photo-overlay-close')?.addEventListener('click', () => {
  document.getElementById('photo-overlay')?.classList.add('hidden');
});

// Kamera és Funkció Gombok
document.getElementById('cam-toggle-btn')?.addEventListener('click', cycleCamera);
document.getElementById('de-toggle-btn')?.addEventListener('click', (e) => {
  S.deActive = !S.deActive;
  S.deStage = 0;
  markUniformsDirty();
  e.currentTarget.classList.toggle('active', S.deActive);
  document.getElementById('shutter')?.classList.remove('de-primed');
  updateFocusLabel('AF');
});

document.getElementById('torch-toggle-btn')?.addEventListener('click', (e) => {
  Store.flashEnabled = !Store.flashEnabled;
  e.currentTarget.classList.toggle('active', Store.flashEnabled);
});

document.getElementById('dust-toggle-btn')?.addEventListener('click', (e) => {
  if (window.FX) {
    window.FX.active = !window.FX.active;
    e.currentTarget.classList.toggle('active', window.FX.active);
    if (window.FX.active) window.FX.randomize();
    updateCanvasDimensions();
    markUniformsDirty();
  }
});

document.getElementById('mf-toggle-btn')?.addEventListener('click', (e) => {
  S.mfActive = !S.mfActive;
  e.currentTarget.classList.toggle('active', S.mfActive);
  
  const fring = document.getElementById('focus-ring');
  if (fring) {
    fring.classList.toggle('hidden', !S.mfActive);
    fring.style.top = '50%';
    fring.style.left = '50%';
    fring.classList.remove('locked');
  }
  
  if (S.mfActive) {
    S.mode = 'focus';
    updateFocusLabel('MF');
  } else {
    S.mode = 'exposure';
    updateFocusLabel('AF');
    // Visszaállítjuk a kamerát automata fókuszra
    if (S.stream) {
      const tk = S.stream.getVideoTracks()[0];
      tk?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
    }
  }
  
  // Újraépítjük a tárcsát az új módnak megfelelően
  buildDial();
  syncDial();
});

// Dátum kapcsoló figyelése
document.getElementById('date-tog')?.addEventListener('change', () => {
  updateLiveDate();
});

// Keret rádiógombok figyelése
document.querySelectorAll('input[name="frame-opt"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const frame = getSelectedFrame();
    
    // Élőkép keretek elrejtése/megjelenítése a VF-en (Viewport)
    document.getElementById('preview-frame-film')?.classList.toggle('hidden', frame !== 'film');
    document.getElementById('preview-frame-antik')?.classList.toggle('hidden', frame !== 'antik');
    
    // Dátum és kapcsoló állapotának frissítése
    syncDateToggleAvailability();
    updateLiveDate();
    
    // WebGL újrarajzolás kényszerítése
    markUniformsDirty();
  });
});

// Tárcsa eseménykezelése
const dialEl = document.getElementById('dial-wrap');
let ddrag = false, dstart = 0, initialValue = 0;

if (dialEl) {
  dialEl.addEventListener('pointerdown', e => {
    ddrag = true;
    try { dialEl.setPointerCapture(e.pointerId); } catch (_) {}
    
    if (S.mode === 'focus') {
      updateFocusUI(e.clientX);
    } else {
      dstart = e.clientX;
      initialValue = {exposure:S.exposure, shadows:S.shadows, highlights:S.highlights, tone:S.tone, grain:S.grain, vignette:S.vignette}[S.mode];
    }
  }, { passive: true });
  
  dialEl.addEventListener('pointermove', e => {
    if (!ddrag) return;
    
    if (S.mode === 'focus') {
      updateFocusUI(e.clientX);
    } else {
      const totalDeltaX = e.clientX - dstart;
      const modes_meta = {
        exposure:   { step:.05 },
        shadows:    { step:.02 },
        highlights: { step:.02 },
        tone:       { step:.04 },
        grain:      { step:.02 },
        vignette:   { step:.04 },
      };
      const step = modes_meta[S.mode]?.step || 0.01;
      const sensitivity = step / 14;
      const newValue = initialValue + totalDeltaX * sensitivity;
      
      setV(newValue);
      syncDial();
    }
  }, { passive: true });
  
  dialEl.addEventListener('pointerup', () => {
    ddrag = false;
  });
  
  dialEl.addEventListener('pointercancel', () => {
    ddrag = false;
  });
}

// Módváltó gombok (EV, Shadows, Highlights, Tone, Grain, Vig)
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.mode = btn.dataset.mode;
    buildDial(); 
    syncDial();
  });
});

// Exponálógomb logikája (Elő-élesítés)
const shutterBtn = document.getElementById('shutter');

function armCapture(e) {
  if (S.saving || !S.ready) return;
  try { if (shutterBtn) shutterBtn.setPointerCapture(e.pointerId); } catch (_) {}
  
  armPromise = (async () => {
    await setStreamResolution(CAPTURE_RES);
    if (Store.flashEnabled && S.stream) {
      const tk = S.stream.getVideoTracks()[0];
      if (tk) {
        setTorchArmed(false);
        try {
          await tk.applyConstraints({ advanced: [{ torch: true }] });
          let st = {}; try { st = tk.getSettings(); } catch(_) {}
          if (st.torch === true) setTorchArmed(true);
          else {
            await tk.applyConstraints({ torch: true });
            try { st = tk.getSettings(); } catch(_) {}
            setTorchArmed(st.torch === true);
          }
        } catch (err) {}
      }
    }
  })();
}

function disarmCapture() {
  armPromise = null;
  torchOff();
  if (!S.saving) setStreamResolution(PREVIEW_RES, false);
}

if (shutterBtn) {
  shutterBtn.addEventListener('pointerdown', armCapture, { passive: true });
  shutterBtn.addEventListener('pointerup', capture);
  shutterBtn.addEventListener('pointercancel', disarmCapture);
}

// Diag Rejtett Gomb
let diagTaps = 0, diagTapTimer = null;
document.querySelector('.brand')?.addEventListener('click', () => {
  diagTaps++;
  clearTimeout(diagTapTimer);
  diagTapTimer = setTimeout(() => { diagTaps = 0; }, 1600);
  if (diagTaps >= 7) { diagTaps = 0; toggleDiag(); }
});

// Fő Inicializáció
(async () => {
  checkStandaloneGuard(); 
  initDiagnostics();

  if (!initGL()) { 
    const pe = document.getElementById('perm-err'); 
    if (pe) pe.textContent = 'WebGL nem elérhető.'; 
    return; 
  }
  
  if (Elements.glCv) {
    Elements.glCv.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      cancelAnimationFrame(S.raf);
      S.raf = null;
      S.ready = false;
    });
    Elements.glCv.addEventListener('webglcontextrestored', () => {
      if (!initGL()) return;
      markUniformsDirty();
      const ld = PROF[S.simKey]?.lut;
      if (ld) uploadLUT(ld);
      if (S.stream) render();
    });
  }

  buildDial();
  await loadExternalFilters();
  
  if (PROF[S.simKey]) {
    uploadLUT(PROF[S.simKey].lut);
    const fl = document.getElementById('film-label'); 
    if (fl) fl.textContent = PROF[S.simKey].name;
  }
  
  syncDial();
  syncDateToggleAvailability();
  updateLiveDate();
  
  await listVideoDevices();
  if (navigator.mediaDevices?.getUserMedia) initCam();
  else { 
    const pe = document.getElementById('perm-err'); 
    if (pe) pe.textContent = 'Kamera API nem támogatott.'; 
  }
})();