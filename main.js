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
let vfPointers = new Map();
let vfInitDist = 0;
let vfInitZoom = 1.0;
let isPinching = false;

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

function syncViewportHeight() {
  const h = window.innerHeight;
  if (h > 0) {
    document.documentElement.style.setProperty('--app-h', `${h}px`);
  }
}

syncViewportHeight();
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);
window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 250));

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

function updateFramePreviewState() {
  const frame = getSelectedFrame();
  const disableFrames = S.aspectRatio === '3:2';
  const filmFrame = document.getElementById('preview-frame-film');
  const antikFrame = document.getElementById('preview-frame-antik');
  filmFrame?.classList.toggle('hidden', disableFrames || frame !== 'film');
  antikFrame?.classList.toggle('hidden', disableFrames || frame !== 'antik');

  const frameGroup = document.querySelector('.frame-radio-group');
  if (frameGroup) {
    frameGroup.classList.toggle('disabled', disableFrames);
    frameGroup.querySelectorAll('input').forEach(input => {
      input.disabled = disableFrames;
    });
  }
}

function updateAspectRatioUI() {
  const aspectBtn = document.getElementById('aspect-toggle-btn');
  const aspectText = aspectBtn?.querySelector('.btn-text');
  const previewWrapper = document.getElementById('preview-wrapper');

  if (aspectBtn) {
    aspectBtn.classList.toggle('active', S.aspectRatio === '3:2');
    if (aspectText) aspectText.textContent = S.aspectRatio;
    aspectBtn.title = `Képarány: ${S.aspectRatio}`;
  }

  if (previewWrapper) {
    previewWrapper.classList.toggle('aspect-3-2', S.aspectRatio === '3:2');
  }

  updateFramePreviewState();
  updateLiveDate();
  updateCanvasDimensions();
  markUniformsDirty();
}

document.getElementById('aspect-toggle-btn')?.addEventListener('click', (e) => {
  S.aspectRatio = S.aspectRatio === '1:1' ? '3:2' : '1:1';
  updateAspectRatioUI();
});

// Dátum kapcsoló figyelése
document.getElementById('date-tog')?.addEventListener('change', () => {
  updateLiveDate();
});

// Keret rádiógombok figyelése
document.querySelectorAll('input[name="frame-opt"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const frame = getSelectedFrame();
    
    updateFramePreviewState();
    syncDateToggleAvailability();
    updateLiveDate();
    markUniformsDirty();
  });
});

// Pinch-to-Zoom & Tap-to-focus
const vfOverlay = document.getElementById('focus-overlay');
if (vfOverlay) {
  vfOverlay.addEventListener('pointerdown', e => {
    try { vfOverlay.setPointerCapture(e.pointerId); } catch (_) {}
    vfPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (vfPointers.size === 2) {
      isPinching = true;
      const pts = [...vfPointers.values()];
      vfInitDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      vfInitZoom = S.zoom;
    }
  });

  vfOverlay.addEventListener('pointermove', e => {
    if (!vfPointers.has(e.pointerId)) return;
    vfPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    if (isPinching && vfPointers.size === 2) {
      const pts = [...vfPointers.values()];
      const dist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
      if (vfInitDist > 0) {
        const factor = dist / vfInitDist;
        let nz = vfInitZoom * factor;
        nz = Math.max(1.0, Math.min(4.0, nz)); // Clamp zoom between 1x and 4x
        S.zoom = Math.round(nz / 0.05) * 0.05; // Snap to 0.05 steps
        markUniformsDirty();
      }
    }
  });

  const handleVfPointerUp = (e) => {
    try { vfOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
    vfPointers.delete(e.pointerId);
    if (vfPointers.size < 2) {
      isPinching = false;
    }
  };

  vfOverlay.addEventListener('pointerup', handleVfPointerUp);
  vfOverlay.addEventListener('pointercancel', handleVfPointerUp);
}

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
      const sensitivity = step / 8.4;
      const newValue = initialValue - totalDeltaX * sensitivity;
      
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
  shutterBtn.addEventListener('pointerup', async () => {
    if (armPromise) {
      try { await armPromise; } catch (_) {}
    }
    capture();
  });
  shutterBtn.addEventListener('pointercancel', disarmCapture);
}

// Exit gomb
document.getElementById('exit-btn')?.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(()=>{});
  } else {
    if (S.stream) {
      S.stream.getTracks().forEach(t => t.stop());
      S.ready = false;
    }
    window.close();
  }
});

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
  updateAspectRatioUI();
  
  await listVideoDevices();
  if (navigator.mediaDevices?.getUserMedia) initCam();
  else { 
    const pe = document.getElementById('perm-err'); 
    if (pe) pe.textContent = 'Kamera API nem támogatott.'; 
  }
})();
