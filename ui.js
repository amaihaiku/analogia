/** 
 * ui.js 
 * Felhasználói felület eseménykezelése, tárcsa-logika, HUD és érintés-kezelés.
 */
import { S, Store, PROF } from './state.js';
import { dlog } from './utils.js';
import { markUniformsDirty, updateCanvasDimensions } from './webgl.js';
import { setStreamResolution } from './camera.js';
import { capture } from './capture.js';

// Tárcsa beállítások (a korábbi MODES objektum)
const MODES = {
  exposure:   {min:-2,  max:2,   step:.05,hasCenter:true, fmt:v=>(v>0?'+':'')+v.toFixed(2)+' EV'},
  shadows:    {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  highlights: {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  tone:       {min:-1,  max:1,   step:.04,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  grain:      {min:0,   max:1,   step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
  vignette:   {min:-1,  max:1,   step:.04,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  focus:      {min:0,   max:1,   step:.01,hasCenter:false,fmt:v=>v.toFixed(2)}
};

const TPX = 14; 
let ddrag = false, dlast = 0, doff = 0;
let mfTimeout = null;

// --- HUD Frissítés (A HIÁNYZÓ FÜGGVÉNY JAVÍTVA) ---
export function updHUD(v) {
  const m = MODES[S.mode];
  const el = document.getElementById('hud-val');
  if (el && m) el.textContent = m.fmt(v);
}

export function updateFocusLabel(txt) {
  const fl = document.getElementById('hud-focus-label');
  if (fl) fl.textContent = txt || 'AF';
}

// --- Tárcsa Logika ---
function nT() { return Math.round((MODES[S.mode].max - MODES[S.mode].min) / MODES[S.mode].step); }
function getV() { return {exposure:S.exposure,shadows:S.shadows,highlights:S.highlights,tone:S.tone,grain:S.grain,vignette:S.vignette,focus:S.focusDist}[S.mode]; }

export function setV(v) {
  const m = MODES[S.mode];
  v = Math.max(m.min, Math.min(m.max, Math.round(v / m.step) * m.step));
  const prevGrain = S.grain;
  
  if(S.mode==='exposure') S.exposure=v;
  else if(S.mode==='shadows') S.shadows=v;
  else if(S.mode==='highlights') S.highlights=v;
  else if(S.mode==='tone') S.tone=v;
  else if(S.mode==='grain') S.grain=v;
  else if(S.mode==='focus'){
    S.focusDist = v;
    if(S.mfActive && S.stream){
      const tk = S.stream.getVideoTracks()[0];
      if(tk) {
        clearTimeout(mfTimeout);
        mfTimeout = setTimeout(() => {
          tk.applyConstraints({ focusMode: 'manual', advanced: [{ focusDistance: S.focusDist }] }).catch(()=>{});
        }, 50);
      }
    }
  }
  else S.vignette=v;
  
  if(S.mode==='grain' && ((prevGrain===0) !== (S.grain===0))) updateCanvasDimensions();
  markUniformsDirty();
  return v;
}

function o2v(o) { const m = MODES[S.mode], N = nT(); return m.min + (-o / N / TPX) * (m.max - m.min); }
function v2o(v) { const m = MODES[S.mode], N = nT(); return -((v - m.min) / (m.max - m.min)) * N * TPX; }

export function buildDial() {
  const el = document.getElementById('dial-ticks'); if(!el) return;
  el.innerHTML = '';
  const m = MODES[S.mode], N = nT();
  const cm = document.querySelector('.dial-center-h');

  // Stílusok nullázása, hogy a CSS-ből jövő alapértékek érvényesüljenek
  el.style.padding = '';
  el.style.width = '';
  el.style.justifyContent = '';

  if (S.mode === 'focus') {
    el.style.padding = '0'; el.style.width = '100%'; el.style.justifyContent = 'space-between';
    for(let i=0; i<=20; i++){
      const t = document.createElement('div');
      const maj = i%5===0;
      t.className = 'dt' + (maj?' maj':'');
      t.style.height = (maj?28:15)+'px';
      el.appendChild(t);
    }
    if(cm) cm.style.opacity = '1'; 
  } else {
    // Itt már a CSS-ben megadott 'padding: 0 50vw' és egyéb stílusok érvényesülnek
    const cIdx = m.hasCenter ? Math.round((0 - m.min) / m.step) : -1;
    for(let i=0; i<=N; i++){
      const t = document.createElement('div'), maj = i%5===0, isC = (i===cIdx);
      t.className = 'dt' + (maj?' maj':'') + (isC?' zero':'');
      t.style.height = (maj?28:15)+'px';
      el.appendChild(t);
    }
    if(cm) cm.style.opacity = m.hasCenter?'1':'0';
    const dialWrap = document.getElementById('dial-wrap');
    if(dialWrap && cm) cm.style.left = dialWrap.clientWidth / 2 + 'px';
  }
}

export function syncDial() {
  const el = document.getElementById('dial-ticks');
  const centerLine = document.querySelector('.dial-center-h');
  const dialWrap = document.getElementById('dial-wrap');
  
  if (S.mode === 'focus') {
    if (el) el.style.transform = `translateX(0px)`;
    if (centerLine && dialWrap) {
      const m = MODES.focus;
      const range = m.max - m.min || 1;
      const pct = (S.focusDist - m.min) / range;
      centerLine.style.left = (pct * dialWrap.clientWidth) + 'px';
    }
    updHUD(S.focusDist);
  } else {
    const v = getV(), o = v2o(v); doff = o;
    if (el) el.style.transform = `translateX(${o - 7}px)`;
    if (centerLine && dialWrap) centerLine.style.left = (dialWrap.clientWidth / 2) + 'px';
    updHUD(v);
  }
}

export function updateFocusUI(clientX) {
  const dialEl = document.getElementById('dial-wrap');
  if (!dialEl) return;
  const rect = dialEl.getBoundingClientRect();
  let x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const pct = x / rect.width;
  const m = MODES.focus;
  const val = m.min + pct * (m.max - m.min);
  setV(val);
  syncDial();
}

// Keret és Dátum kezelés
export function getSelectedFrame() {
  const activeRadio = document.querySelector('input[name="frame-opt"]:checked');
  return activeRadio ? activeRadio.value : 'none';
}

export function syncDateToggleAvailability() {
  const dateTog = document.getElementById('date-tog');
  if (!dateTog) return;
  const frame = getSelectedFrame();
  const dateGroup = dateTog.closest('.toggle-group');
  if (frame === 'antik') {
    if (dateTog.checked) dateTog.checked = false;
    dateTog.disabled = true;
    if (dateGroup) dateGroup.classList.add('disabled');
  } else {
    dateTog.disabled = false;
    if (dateGroup) dateGroup.classList.remove('disabled');
  }
}

export function updateLiveDate() {
  let el = document.getElementById('live-date');
  if (!el) {
    el = document.createElement('div');
    el.id = 'live-date';
    el.className = 'live-date';
    const bezel = document.querySelector('.vf-bezel');
    if (bezel) bezel.appendChild(el);
  }
  
  const dateTog = document.getElementById('date-tog');
  if (!dateTog || !dateTog.checked) {
    el.classList.add('hidden');
    return;
  }
  
  const frame = getSelectedFrame();
  
  if (frame === 'antik') {
    el.classList.add('hidden');
    return;
  } else {
    const now = new Date(), p = n => String(n).padStart(2, '0');
    el.textContent = `${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
    el.style.left = 'auto';
    el.style.width = 'auto';
    el.style.right = '12px';
    el.style.textAlign = 'right';
    el.style.fontFamily = "'Courier New', Courier, monospace";
    el.style.fontWeight = 'bold';
    el.style.fontSize = '14px';
    el.style.color = '#e8830a';

    if (frame === 'film') {
      el.style.bottom = 'calc(13% + 12px)'; 
    } else {
      el.style.bottom = '12px';
    }
  }
  el.classList.remove('hidden');
}