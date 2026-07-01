/** 
 * camera.js 
 * Kamera inicializálása, stream kezelése, vaku és felbontásváltás.
 */
import { S, Store, Elements, PREVIEW_RES } from './state.js';
import { dlog, showToast } from './utils.js';
import { markUniformsDirty, updateCanvasDimensions, render } from './webgl.js';
// A ui.js-t később hozzuk létre, de már előkészítjük a hívásait:
import { buildDial, syncDial, updateFocusLabel } from './ui.js';

let resReqId = 0;
export let torchArmed = false;

export async function listVideoDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    Store.videoDevices = devices.filter(d => d.kind === 'videoinput');
  } catch(_) { 
    Store.videoDevices = []; 
  }
}

export async function cycleCamera() {
  if (Store.videoDevices.length <= 1) await listVideoDevices();
  if (Store.videoDevices.length <= 1) return;
  Store.currentDeviceIndex = (Store.currentDeviceIndex + 1) % Store.videoDevices.length;
  const nextDevice = Store.videoDevices[Store.currentDeviceIndex];
  if (nextDevice) await initCam(nextDevice.deviceId);
}

export async function initCam(preferredDeviceId = null) {
  // Előző render-loop leállítása a memóriaszivárgás elkerülésére
  if (S.raf) { 
    cancelAnimationFrame(S.raf); 
    S.raf = null; 
  }
  if (S.stream) {
    S.stream.getTracks().forEach(track => track.stop());
  }
  markUniformsDirty();
  
  try {
    const constraints = { 
      audio: false, 
      video: { width: { ideal: PREVIEW_RES }, height: { ideal: PREVIEW_RES } } 
    };
    if (preferredDeviceId) constraints.video.deviceId = { exact: preferredDeviceId };
    else constraints.video.facingMode = { ideal: 'environment' };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    S.stream = stream; 
    
    if (Elements.vid) {
      Elements.vid.srcObject = stream;
      if (Store.onVidMeta) { 
        Elements.vid.removeEventListener('loadedmetadata', Store.onVidMeta); 
        Store.onVidMeta = null; 
      }
      
      Store.onVidMeta = () => {
        Store.onVidMeta = null;
        S.ready = true;
        const tk = stream.getVideoTracks()[0];
        const st = tk.getSettings();
        
        // --- ÚJ: Hardveres képességek lekérdezése (Zoom) ---
        try {
          const caps = tk.getCapabilities ? tk.getCapabilities() : {};
          Store.zoomCaps = caps.zoom || null;
        } catch(e) { Store.zoomCaps = null; }
        
        if (Store.videoDevices.length === 0) {
          listVideoDevices().then(() => {
            Store.currentDeviceIndex = Store.videoDevices.findIndex(d => d.deviceId === st.deviceId);
            if (Store.currentDeviceIndex === -1) Store.currentDeviceIndex = 0;
          });
        } else {
          Store.currentDeviceIndex = Store.videoDevices.findIndex(d => d.deviceId === st.deviceId);
          if (Store.currentDeviceIndex === -1) Store.currentDeviceIndex = 0;
        }
        
        S.vidW = st.width || Elements.vid.videoWidth;
        S.vidH = st.height || Elements.vid.videoHeight;
        Elements.vid.play().catch(()=>{});
        
        const resEl = document.getElementById('hud-res'); 
        if (resEl) resEl.textContent = S.vidW + '×' + S.vidH;
        
        const npEl = document.getElementById('noperm'); 
        if (npEl) npEl.style.display = 'none';
        
        S.focusLock = null;
        const fring = document.getElementById('focus-ring');
        if (fring) fring.classList.add('hidden');
        
        S.mfActive = false;
        const mfBtn = document.getElementById('mf-toggle-btn');
        if (mfBtn) mfBtn.classList.remove('active');
        
        if (S.mode === 'focus') {
          S.mode = 'exposure';
          const expBtn = document.querySelector('[data-mode="exposure"]');
          if (expBtn) expBtn.classList.add('active');
          buildDial(); 
          syncDial();
        }
        
        updateFocusLabel('AF');
        tk.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
        updateCanvasDimensions();
        render();
      };
      Elements.vid.addEventListener('loadedmetadata', Store.onVidMeta, { once: true });
    }
  } catch (e) {
    const peEl = document.getElementById('perm-err');
    if (peEl) {
      peEl.textContent = e.name === 'NotAllowedError' ? 'Engedély megtagadva.' 
                       : e.name === 'NotFoundError' ? 'Nincs kamera.' 
                       : 'Kamera hiba.';
    }
  }
}

export function trackSupportsTorch(track) {
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    return !!caps.torch;
  } catch (_) { return false; }
}

export function setTorchArmed(state) {
  torchArmed = state;
}

export function torchOff() {
  if (!torchArmed) return;
  torchArmed = false;
  const tk = S.stream && S.stream.getVideoTracks()[0];
  if (tk) tk.applyConstraints({ advanced: [{ torch: false }] }).catch(()=>{});
}

export function waitForVideoFrames(n, minMs) {
  const startTime = performance.now();
  const hasRVFC = Elements.vid && typeof Elements.vid.requestVideoFrameCallback === 'function';
  return new Promise(resolve => {
    let framesSeen = 0;
    let settled = false;
    const done = () => { 
      if (settled) return; 
      settled = true; 
      clearTimeout(minTimer); 
      clearTimeout(hardTimer); 
      resolve(); 
    };

    const minTimer = setTimeout(() => {
      if (framesSeen >= n || !hasRVFC) done();
    }, minMs);

    const hardTimer = setTimeout(done, minMs + 400);

    if (hasRVFC) {
      const step = () => {
        framesSeen++;
        if (framesSeen >= n && (performance.now() - startTime) >= minMs) {
          done();
        } else if (!settled) {
          Elements.vid.requestVideoFrameCallback(step);
        }
      };
      Elements.vid.requestVideoFrameCallback(step);
    }
  });
}

export async function setStreamResolution(px, waitFrames = true) {
  if (!S.stream) return false;
  const tk = S.stream.getVideoTracks()[0];
  if (!tk) return false;
  
  resReqId++;
  const myReq = resReqId;
  let ok = true;
  
  try {
    const constraints = { width: { ideal: px, max: px }, height: { ideal: px, max: px } };
    if (S.mfActive && S.focusDist !== undefined) {
      constraints.advanced = [{ focusMode: 'manual', focusDistance: S.focusDist }];
    }

    await tk.applyConstraints(constraints);

    if (S.mfActive && S.focusDist !== undefined) {
      try { 
        tk.applyConstraints({ focusMode: 'continuous', advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
      } catch(e) {}
    }

    if (waitFrames) await waitForVideoFrames(3, 250);
  } catch (_) { ok = false; }

  const sync = () => {
    let st = {};
    try { st = tk.getSettings(); } catch (_) {}
    S.vidW = Elements.vid.videoWidth || st.width || S.vidW;
    S.vidH = Elements.vid.videoHeight || st.height || S.vidH;
    const resEl = document.getElementById('hud-res');
    if (resEl) resEl.textContent = S.vidW + '×' + S.vidH;
    markUniformsDirty();
    return st;
  };
  sync();
  
  if (!waitFrames) {
    setTimeout(() => {
      if (myReq !== resReqId || !S.stream || S.saving) return;
      if (S.stream.getVideoTracks()[0] !== tk || tk.readyState !== 'live') return;
      const st = sync();
      if (Math.min(S.vidW, S.vidH) > px * 1.5) {
        console.warn('Felbontásváltás beragadt (' + S.vidW + '×' + S.vidH + ' > ' + px + '), stream újranyitása');
        initCam(st.deviceId || null);
      }
    }, 700);
  }
  return ok;
}