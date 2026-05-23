/**
 * ANALOGIA RF-1 — app.js
 * Pipeline: Camera → Exposure 2D Canvas → LUT → Vignette → WebGL Grain Shader
 */
'use strict';

/* ═══════════════════════════════════════════════
   1. STATE
═══════════════════════════════════════════════ */
const S = {
  stream: null, raf: null, ready: false,
  sim: 'kodachrome',
  lut: null,            // { d: Float32Array, sz: number }
  ev: 0,                // -2 .. +2
  zoom: 1.0,            // 1.0 .. 4.0
  focusDist: 0,         // 0 = auto, 0.1–1.0 manual
  grain: 0,             // 0..1
  grainSize: 2.0,
  vignette: 0,          // 0..1
  dateStamp: false,
  frame: 'none',
  mode: 'exposure',     // active dial mode
  shots: 0,
  glReady: false,
};

/* ═══════════════════════════════════════════════
   2. BUILT-IN FILM PROFILES
═══════════════════════════════════════════════ */
function sCurve(x, p, c) { const t = x - p; return t / Math.sqrt(1 + (c * t) * (c * t)) + p; }
function cl(v) { return Math.max(0, Math.min(1, v)); }
function c255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

const PROFILES = {
  kodachrome: {
    name: 'KODACHROME 64',
    sub: 'Rich contrast · Warm reds · Cyan shadows',
    fn(r, g, b) {
      let rn = sCurve(r/255, .55, 1.6), gn = sCurve(g/255, .5, 1.5), bn = sCurve(b/255, .48, 1.45);
      const l = .299*rn + .587*gn + .114*bn, sh = Math.max(0, 1 - l*2.5);
      rn += l*.08; gn -= l*.02; bn -= l*.04;
      gn -= sh*.04; bn += sh*.07;
      const a = (rn+gn+bn)/3;
      return [cl(a+(rn-a)*1.25)*255, cl(a+(gn-a)*1.1)*255, cl(a+(bn-a)*1.15)*255];
    }
  },
  fuji: {
    name: 'FUJI SUPERIA',
    sub: 'Teal shadows · Soft skin · Lifted blacks',
    fn(r, g, b) {
      let rn = r/255*.93+.04, gn = g/255*.93+.04, bn = b/255*.93+.04;
      rn = sCurve(rn,.52,1.3); gn = sCurve(gn,.52,1.3); bn = sCurve(bn,.52,1.3);
      const l = .299*rn+.587*gn+.114*bn, sh = Math.max(0,1-l*3), hi = Math.max(0,l*2-1);
      gn += sh*.06; bn += sh*.05; rn -= sh*.03; rn += hi*.04; bn -= hi*.03;
      const a = (rn+gn+bn)/3;
      return [cl(a+(rn-a)*.9)*255, cl(a+(gn-a)*.92)*255, cl(a+(bn-a)*.88)*255];
    }
  },
  acros: {
    name: 'B&W ACROS',
    sub: 'High contrast · Optical channel mix',
    fn(r, g, b) {
      let l = .35*r/255 + .52*g/255 + .13*b/255;
      l = sCurve(l, .5, 2.0);
      if (l < .5) l *= .92;
      if (l > .85) l = .85 + (l-.85)*.5;
      const o = cl(l)*255;
      return [o, o, o];
    }
  },
  portra: {
    name: 'KODAK PORTRA 400',
    sub: 'Natural skin · Pastel palette · Fine grain',
    fn(r, g, b) {
      let rn = r/255, gn = g/255, bn = b/255;
      rn = sCurve(rn, .48, 1.2); gn = sCurve(gn, .5, 1.15); bn = sCurve(bn, .52, 1.1);
      const l = .299*rn+.587*gn+.114*bn;
      rn += l*.05; gn += l*.02; bn -= l*.02;
      const a = (rn+gn+bn)/3;
      rn = a+(rn-a)*.85; gn = a+(gn-a)*.88; bn = a+(bn-a)*.82;
      return [cl(rn)*255, cl(gn)*255, cl(bn)*255];
    }
  },
  velvia: {
    name: 'FUJI VELVIA 50',
    sub: 'Ultra saturated · Deep shadows · Vivid',
    fn(r, g, b) {
      let rn = sCurve(r/255,.5,2.2), gn = sCurve(g/255,.5,2.0), bn = sCurve(b/255,.5,1.9);
      const a = (rn+gn+bn)/3;
      rn = a+(rn-a)*1.5; gn = a+(gn-a)*1.45; bn = a+(bn-a)*1.4;
      rn += .02; bn -= .02;
      return [cl(rn)*255, cl(gn)*255, cl(bn)*255];
    }
  },
  hp5: {
    name: 'ILFORD HP5',
    sub: 'Classic B&W · Wide latitude · Natural',
    fn(r, g, b) {
      let l = .299*r/255 + .587*g/255 + .114*b/255;
      l = sCurve(l, .48, 1.5);
      const o = cl(l)*255;
      return [o, o, o];
    }
  },
};

/* LUTs loaded from /luts/ folder */
const LOADED_LUTS = {}; // name → { d, sz }

/* ═══════════════════════════════════════════════
   3. LUT PARSER
═══════════════════════════════════════════════ */
function parseCube(txt) {
  const lines = txt.split('\n'); let sz = 33; const ent = [];
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
    if (line.startsWith('LUT_3D_SIZE')) { sz = parseInt(line.split(/\s+/)[1]); continue; }
    if (line.startsWith('DOMAIN_') || line.startsWith('LUT_')) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length === 3 && !p.some(isNaN)) ent.push(p[0], p[1], p[2]);
  }
  const exp = sz * sz * sz * 3;
  if (ent.length !== exp) throw new Error(`CUBE: ${ent.length}/${exp}`);
  return { d: new Float32Array(ent), sz };
}

function applyLUT(r, g, b, lut, sz) {
  const sc = (sz-1)/255, rf = r*sc, gf = g*sc, bf = b*sc;
  const r0=Math.floor(rf),r1=Math.min(r0+1,sz-1);
  const g0=Math.floor(gf),g1=Math.min(g0+1,sz-1);
  const b0=Math.floor(bf),b1=Math.min(b0+1,sz-1);
  const dr=rf-r0, dg=gf-g0, db=bf-b0;
  function idx(a,c,d){return(d*sz*sz+c*sz+a)*3}
  const out=[];
  for(let ch=0;ch<3;ch++){
    const v000=lut[idx(r0,g0,b0)+ch],v100=lut[idx(r1,g0,b0)+ch];
    const v010=lut[idx(r0,g1,b0)+ch],v110=lut[idx(r1,g1,b0)+ch];
    const v001=lut[idx(r0,g0,b1)+ch],v101=lut[idx(r1,g0,b1)+ch];
    const v011=lut[idx(r0,g1,b1)+ch],v111=lut[idx(r1,g1,b1)+ch];
    const c00=v000+(v100-v000)*dr, c10=v010+(v110-v010)*dr;
    const c01=v001+(v101-v001)*dr, c11=v011+(v111-v011)*dr;
    const c0=c00+(c10-c00)*dg,     c1=c01+(c11-c01)*dg;
    out.push((c0+(c1-c0)*db)*255);
  }
  return out;
}

/* ═══════════════════════════════════════════════
   4. WEBGL GRAIN SHADER
═══════════════════════════════════════════════ */
const GL_VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Organic grain: hash-based smooth noise + luminance mask
const GL_FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_time;
uniform float u_amount;
uniform float u_size;

float hash(vec2 p){
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// Smooth noise: bilinear interpolation of hash
float smoothNoise(vec2 uv){
  vec2 i = floor(uv);
  vec2 f = fract(uv);
  vec2 u = f*f*(3.0-2.0*f); // smoothstep
  float a = hash(i);
  float b = hash(i + vec2(1,0));
  float c = hash(i + vec2(0,1));
  float d = hash(i + vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// FBM: 3 octaves for organic feel
float fbm(vec2 uv){
  float v = 0.0;
  float amp = 0.5;
  for(int i=0;i<3;i++){
    v += smoothNoise(uv) * amp;
    uv *= 2.0;
    amp *= 0.5;
  }
  return v;
}

// Luminance-based grain curve: peak at 0.5, zero at 0 and 1
float grainCurve(float lum){
  float t = 1.0 - abs(lum - 0.5) * 2.0;
  return t*t*(3.0-2.0*t); // smoothstep tent
}

void main(){
  vec4 color = texture2D(u_tex, v_uv);
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  // Animated noise (frame jitter via u_time)
  vec2 noiseUV = v_uv * u_size + vec2(u_time * 0.17, u_time * 0.13);
  float noise = fbm(noiseUV) * 2.0 - 1.0; // -1..1

  float mask = grainCurve(lum);
  float grain = noise * u_amount * mask;

  // Output grain as additive overlay (white channel, screen blend in CSS)
  float g = 0.5 + grain * 0.5; // remap to 0..1 for overlay
  gl_FragColor = vec4(g, g, g, u_amount * mask * 0.8);
}`;

let gl, glProgram, glTex, glU = {};

function initWebGL(canvas) {
  const ctx = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
  if (!ctx) return false;
  gl = ctx;

  const vs = compileShader(gl.VERTEX_SHADER, GL_VERT);
  const fs = compileShader(gl.FRAGMENT_SHADER, GL_FRAG);
  if (!vs || !fs) return false;

  glProgram = gl.createProgram();
  gl.attachShader(glProgram, vs);
  gl.attachShader(glProgram, fs);
  gl.linkProgram(glProgram);
  if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) { console.error('GL link:', gl.getProgramInfoLog(glProgram)); return false; }
  gl.useProgram(glProgram);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(glProgram, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // Uniforms
  glU.tex    = gl.getUniformLocation(glProgram, 'u_tex');
  glU.time   = gl.getUniformLocation(glProgram, 'u_time');
  glU.amount = gl.getUniformLocation(glProgram, 'u_amount');
  glU.size   = gl.getUniformLocation(glProgram, 'u_size');

  // Texture for preview canvas
  glTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  S.glReady = true;
  return true;
}

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('GL compile:', gl.getShaderInfoLog(s)); return null; }
  return s;
}

function renderGrain(previewCanvas) {
  if (!S.glReady || S.grain <= 0) {
    const glc = document.getElementById('gl-canvas');
    const g2 = glc.getContext('2d');
    if (g2) g2.clearRect(0, 0, glc.width, glc.height);
    return;
  }
  const glc = document.getElementById('gl-canvas');
  if (glc.width !== previewCanvas.width || glc.height !== previewCanvas.height) {
    glc.width  = previewCanvas.width;
    glc.height = previewCanvas.height;
    gl.viewport(0, 0, glc.width, glc.height);
  }

  gl.bindTexture(gl.TEXTURE_2D, glTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, previewCanvas);

  gl.uniform1i(glU.tex, 0);
  gl.uniform1f(glU.time, performance.now() / 1000);
  gl.uniform1f(glU.amount, S.grain * 0.55);
  gl.uniform1f(glU.size, (S.grainSize * 60) / (glc.width / 800));

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ═══════════════════════════════════════════════
   5. VIGNETTE (2D canvas overlay)
═══════════════════════════════════════════════ */
let vigLut = null, vigW = 0, vigH = 0;
function buildVig(w, h) {
  if (vigW === w && vigH === h) return;
  vigLut = new Float32Array(w * h);
  const cx = w/2, cy = h/2, mx = Math.sqrt(cx*cx + cy*cy);
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const dx=(x-cx)/mx, dy=(y-cy)/mx;
    vigLut[y*w+x] = dx*dx + dy*dy;
  }
  vigW=w; vigH=h;
}

/* ═══════════════════════════════════════════════
   6. MAIN RENDER LOOP
═══════════════════════════════════════════════ */
const pCv  = document.getElementById('preview');
const pCtx = pCv.getContext('2d', { willReadFrequently: true });
const vid  = document.getElementById('vid');

function renderFrame() {
  S.raf = requestAnimationFrame(renderFrame);
  if (!S.ready || vid.readyState < 2) return;
  const vw = vid.videoWidth, vh = vid.videoHeight;
  if (!vw || !vh) return;

  const bezel = pCv.parentElement;
  const bw = bezel.clientWidth, bh = bezel.clientHeight;
  if (pCv.width !== bw || pCv.height !== bh) {
    pCv.width = bw; pCv.height = bh;
    const glc = document.getElementById('gl-canvas');
    glc.width = bw; glc.height = bh;
  }
  const W = pCv.width, H = pCv.height;

  // Draw video (cover, with zoom)
  const z = S.zoom;
  const ar = vw/vh, car = W/H;
  let dw, dh;
  if (ar > car) { dh = H*z; dw = dh*ar; }
  else           { dw = W*z; dh = dw/ar; }
  const dx = (W-dw)/2, dy = (H-dh)/2;
  pCtx.drawImage(vid, dx, dy, dw, dh);

  // Pixel pipeline
  const id = pCtx.getImageData(0, 0, W, H);
  const d  = id.data;
  buildVig(W, H);

  const evm = Math.pow(2, S.ev);
  const va  = S.vignette;
  const simFn   = PROFILES[S.sim]?.fn;
  const lut     = S.lut;

  for (let i = 0; i < d.length; i += 4) {
    const pi = i >> 2;
    let r = Math.min(255, d[i]   * evm);
    let g = Math.min(255, d[i+1] * evm);
    let b = Math.min(255, d[i+2] * evm);

    // LUT / Film sim
    let rgb;
    if (lut) rgb = applyLUT(r, g, b, lut.d, lut.sz);
    else if (simFn) rgb = simFn(r, g, b);
    else rgb = [r, g, b];
    r=rgb[0]; g=rgb[1]; b=rgb[2];

    // Vignette
    if (va > 0) {
      const vm = 1 - va * vigLut[pi] * 0.88;
      r *= vm; g *= vm; b *= vm;
    }
    d[i]=c255(r); d[i+1]=c255(g); d[i+2]=c255(b);
  }
  pCtx.putImageData(id, 0, 0);

  // WebGL grain overlay
  renderGrain(pCv);
}

/* ═══════════════════════════════════════════════
   7. DIAL
═══════════════════════════════════════════════ */
const MODES = {
  exposure: { min: -2,   max: 2,   step: 0.1,  def: 0,   fmt: v => (v>=0?'+':'')+v.toFixed(1)+' EV' },
  focus:    { min: 0,    max: 1,   step: 0.05, def: 0,   fmt: v => v===0 ? 'AF' : v.toFixed(2)+' m' },
  zoom:     { min: 1.0,  max: 4.0, step: 0.1,  def: 1.0, fmt: v => v.toFixed(1)+'×' },
  grain:    { min: 0,    max: 1,   step: 0.05, def: 0,   fmt: v => Math.round(v*100)+'%' },
  vignette: { min: 0,    max: 1,   step: 0.05, def: 0,   fmt: v => Math.round(v*100)+'%' },
};
const TICK_COUNT = 80;
const TICK_W = 14; // px per tick
let dialOffset = 0; // px from center (visual offset)
let dialDragging = false, dialLastX = 0;

function buildDial() {
  const ticks = document.getElementById('dial-ticks');
  ticks.innerHTML = '';
  for (let i = 0; i < TICK_COUNT; i++) {
    const t = document.createElement('div');
    t.className = 'dial-tick' + (i % 5 === 0 ? ' major' : '');
    const h = i % 5 === 0 ? 24 : 14;
    t.style.cssText = `height:${h}px;margin:0 ${TICK_W/2-1}px`;
    ticks.appendChild(t);
  }
}

function dialValueFromOffset(offset) {
  const m = MODES[S.mode];
  const range = m.max - m.min;
  // Map total dial width to range
  const totalPx = TICK_COUNT * TICK_W;
  const ratio = offset / totalPx; // -0.5..0.5
  let raw = m.def - ratio * range;
  raw = Math.round(raw / m.step) * m.step;
  return Math.max(m.min, Math.min(m.max, raw));
}

function offsetFromValue(val) {
  const m = MODES[S.mode];
  const range = m.max - m.min;
  const totalPx = TICK_COUNT * TICK_W;
  return -(val - m.def) / range * totalPx;
}

function getModeValue() {
  switch(S.mode) {
    case 'exposure': return S.ev;
    case 'focus':    return S.focusDist;
    case 'zoom':     return S.zoom;
    case 'grain':    return S.grain;
    case 'vignette': return S.vignette;
  }
}
function setModeValue(v) {
  switch(S.mode) {
    case 'exposure': S.ev = v; break;
    case 'focus':    S.focusDist = v; applyFocus(v); break;
    case 'zoom':     S.zoom = v; break;
    case 'grain':    S.grain = v; toggleGrainSize(); break;
    case 'vignette': S.vignette = v; break;
  }
}

function updateDialDisplay() {
  const m = MODES[S.mode];
  const val = getModeValue();
  dialOffset = offsetFromValue(val);
  document.getElementById('dial-ticks').style.transform = `translateX(${dialOffset}px)`;
  document.getElementById('hud-mode-val').textContent = m.fmt(val);
  if (S.mode === 'exposure') {
    const sg = S.ev >= 0 ? '+' : '';
    document.getElementById('hud-ev').textContent = sg + S.ev.toFixed(1);
  }
  if (S.mode === 'zoom') document.getElementById('hud-zoom').textContent = S.zoom.toFixed(1)+'×';
}

function applyFocus(dist) {
  if (!S.stream) return;
  const track = S.stream.getVideoTracks()[0];
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (dist === 0) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
    document.getElementById('hud-focus').textContent = 'AF';
  } else {
    const constraints = { advanced: [{ focusMode: 'manual' }] };
    if (caps.focusDistance) {
      const fd = caps.focusDistance;
      constraints.advanced[0].focusDistance = fd.min + dist * (fd.max - fd.min);
    }
    track.applyConstraints(constraints).catch(()=>{});
    document.getElementById('hud-focus').textContent = `MF ${dist.toFixed(2)}`;
  }
}

function toggleGrainSize() {
  const row = document.getElementById('grain-size-row');
  if (S.mode === 'grain' && S.grain > 0) row.classList.remove('hidden');
  else row.classList.add('hidden');
}

// Dial events
const dialTrack = document.getElementById('dial-track');
dialTrack.addEventListener('mousedown', e => { dialDragging=true; dialLastX=e.clientX; e.preventDefault(); });
dialTrack.addEventListener('touchstart', e => { dialDragging=true; dialLastX=e.touches[0].clientX; }, { passive:true });
window.addEventListener('mousemove', e => {
  if (!dialDragging) return;
  const dx = e.clientX - dialLastX; dialLastX = e.clientX;
  dialOffset += dx;
  document.getElementById('dial-ticks').style.transform = `translateX(${dialOffset}px)`;
  const val = dialValueFromOffset(dialOffset);
  setModeValue(val);
  const m = MODES[S.mode];
  document.getElementById('hud-mode-val').textContent = m.fmt(val);
  if (S.mode === 'exposure') document.getElementById('hud-ev').textContent = (S.ev>=0?'+':'')+S.ev.toFixed(1);
  if (S.mode === 'zoom') document.getElementById('hud-zoom').textContent = S.zoom.toFixed(1)+'×';
});
window.addEventListener('touchmove', e => {
  if (!dialDragging) return;
  const dx = e.touches[0].clientX - dialLastX; dialLastX = e.touches[0].clientX;
  dialOffset += dx;
  document.getElementById('dial-ticks').style.transform = `translateX(${dialOffset}px)`;
  const val = dialValueFromOffset(dialOffset);
  setModeValue(val);
  const m = MODES[S.mode];
  document.getElementById('hud-mode-val').textContent = m.fmt(val);
  if (S.mode === 'zoom') document.getElementById('hud-zoom').textContent = S.zoom.toFixed(1)+'×';
}, { passive: true });
window.addEventListener('mouseup', () => { dialDragging = false; });
window.addEventListener('touchend', () => { dialDragging = false; });

/* ═══════════════════════════════════════════════
   8. FILM MODAL
═══════════════════════════════════════════════ */
async function tryLoadLutsFolder() {
  // 1. Read luts/index.json to discover available LUT files.
  //    Works on GitHub Pages, localhost, or any static file server.
  //    Fails silently if not found (e.g. bare file:// without a server).
  let entries = [];
  try {
    const res = await fetch('luts/index.json');
    if (res.ok) {
      const json = await res.json();
      entries = json.luts || [];
    }
  } catch(e) { return; } // no server, skip silently

  // 2. Load each .cube file listed in index.json
  for (const entry of entries) {
    try {
      const res = await fetch(`luts/${entry.file}`);
      if (!res.ok) continue;
      const txt = await res.text();
      const lut = parseCube(txt);
      LOADED_LUTS[entry.file] = {
        d:    lut.d,
        sz:   lut.sz,
        name: entry.name || entry.file.replace('.cube','').replace(/_/g,' ').toUpperCase(),
        sub:  entry.sub  || 'Custom LUT · .cube',
      };
    } catch(e) { console.warn('LUT betöltési hiba:', entry.file, e); }
  }
}

function buildFilmList() {
  const list = document.getElementById('film-list');
  list.innerHTML = '';

  // Built-in profiles
  for (const [key, prof] of Object.entries(PROFILES)) {
    const item = document.createElement('div');
    item.className = 'film-item' + (S.sim === key && !S.lut ? ' active' : '');
    item.dataset.key = key;
    item.innerHTML = `<div class="film-dot"></div><div><div class="film-name">${prof.name}</div><div class="film-sub">${prof.sub}</div></div>`;
    item.addEventListener('click', () => {
      S.sim = key; S.lut = null;
      document.getElementById('film-label').textContent = prof.name;
      closeModal();
    });
    list.appendChild(item);
  }

  // LUTs from /luts/ folder
  for (const [fname, lut] of Object.entries(LOADED_LUTS)) {
    const item = document.createElement('div');
    item.className = 'film-item';
    item.innerHTML = `<div class="film-dot"></div><div><div class="film-name">${lut.name}</div><div class="film-sub">${lut.sub || 'Custom LUT · .cube'}</div></div>`;
    item.addEventListener('click', () => {
      S.lut = { d: lut.d, sz: lut.sz }; S.sim = '__lut__';
      document.getElementById('film-label').textContent = lut.name;
      closeModal();
    });
    list.appendChild(item);
  }
}

function openModal() { buildFilmList(); document.getElementById('film-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('film-modal').classList.add('hidden'); }

document.getElementById('film-btn').addEventListener('click', openModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);

document.getElementById('lut-upload').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const txt = await file.text();
    const lut = parseCube(txt);
    const name = file.name.replace('.cube','').replace(/_/g,' ').toUpperCase();
    LOADED_LUTS[file.name] = { d: lut.d, sz: lut.sz, name };
    S.lut = { d: lut.d, sz: lut.sz }; S.sim = '__lut__';
    document.getElementById('film-label').textContent = name;
    closeModal();
  } catch(err) {
    alert('LUT betöltési hiba: ' + err.message);
  }
  e.target.value = '';
});

/* ═══════════════════════════════════════════════
   9. CAPTURE
═══════════════════════════════════════════════ */
function capture() {
  const vw = vid.videoWidth, vh = vid.videoHeight;
  // Output is 3:2
  let outW = vw, outH = vh;
  // Crop to 3:2
  const targetAR = 3/2;
  if (outW/outH > targetAR) { outW = Math.round(outH * targetAR); }
  else { outH = Math.round(outW / targetAR); }

  let cw = outW, ch = outH, cx = 0, cy = 0;
  const ps = Math.round(outW * .05), pb = Math.round(outW * .18);
  const sh = Math.round(outH * .13);
  const frame = document.getElementById('frame-sel').value;
  if (frame === 'polaroid') { cw = outW+ps*2; ch = outH+ps+pb; cx=ps; cy=ps; }
  else if (frame === 'film') { ch = outH+sh*2; cy = sh; }

  const sv = document.getElementById('save-canvas');
  sv.width = cw; sv.height = ch;
  const sc = sv.getContext('2d');

  if (frame === 'polaroid') { sc.fillStyle='#f4f0e8'; sc.fillRect(0,0,cw,ch); }
  else if (frame === 'film') { drawFilm(sc, cw, ch, sh); }
  else { sc.fillStyle='#000'; sc.fillRect(0,0,cw,ch); }

  // Render at native
  const tmp = document.createElement('canvas');
  tmp.width=outW; tmp.height=outH;
  const tc = tmp.getContext('2d', { willReadFrequently:true });

  // Draw video cropped 3:2
  const z = S.zoom;
  const ar = vw/vh;
  let dw, dh;
  if (ar > targetAR) { dh=outH*z; dw=dh*ar; }
  else               { dw=outW*z; dh=dw/ar; }
  tc.drawImage(vid, (outW-dw)/2, (outH-dh)/2, dw, dh);

  // Pipeline
  const id2 = tc.getImageData(0,0,outW,outH), d2=id2.data;
  const vl = new Float32Array(outW*outH);
  const mx2=Math.sqrt((outW/2)**2+(outH/2)**2);
  for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
    const dxx=(x-outW/2)/mx2,dyy=(y-outH/2)/mx2;
    vl[y*outW+x]=dxx*dxx+dyy*dyy;
  }
  const evm=Math.pow(2,S.ev), va=S.vignette;
  const simFn=PROFILES[S.sim]?.fn, lut=S.lut;
  for(let i=0;i<d2.length;i+=4){
    const pi=i>>2;
    let r=Math.min(255,d2[i]*evm),g=Math.min(255,d2[i+1]*evm),b=Math.min(255,d2[i+2]*evm);
    let rgb=lut?applyLUT(r,g,b,lut.d,lut.sz):(simFn?simFn(r,g,b):[r,g,b]);
    r=rgb[0]; g=rgb[1]; b=rgb[2];
    if(va>0){const vm=1-va*vl[pi]*.88; r*=vm; g*=vm; b*=vm;}
    d2[i]=c255(r); d2[i+1]=c255(g); d2[i+2]=c255(b);
  }
  tc.putImageData(id2,0,0);
  sc.drawImage(tmp,cx,cy,outW,outH);

  if (S.dateStamp) burnDate(sc, cx+outW, cy+outH);
  if (frame==='polaroid') {
    sc.fillStyle='#5a5040';
    sc.font=`bold ${Math.round(ch*.024)}px Courier New`;
    sc.textAlign='center';
    sc.fillText('ANALOGIA RF-1', cw/2, ch-Math.round(ch*.03));
  }

  sv.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url;
    const now=new Date(), p=n=>String(n).padStart(2,'0');
    const simName = (S.lut ? document.getElementById('film-label').textContent : (PROFILES[S.sim]?.name||'CUSTOM')).replace(/ /g,'_');
    a.download=`ANALOGIA_${simName}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.jpg`;
    a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
  }, 'image/jpeg', .95);
}

function drawFilm(c, W, H, sh) {
  c.fillStyle='#111008'; c.fillRect(0,0,W,H);
  [0, H-sh].forEach(sy => {
    c.fillStyle='#1e1c17'; c.fillRect(0,sy,W,sh);
    const hw=Math.round(sh*.5),hh=Math.round(sh*.55),sp=hw*2.2,hy=sy+(sh-hh)/2;
    c.fillStyle='#0a0904';
    let x=sp*.25;
    while(x<W-hw){ c.beginPath(); c.roundRect?c.roundRect(x,hy,hw,hh,3):(c.rect(x,hy,hw,hh)); c.fill(); x+=sp; }
  });
}
function burnDate(c,rx,ry){
  const now=new Date(),p=n=>String(n).padStart(2,'0');
  const ds=`${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
  const fs=Math.max(16,Math.round(ry*.04));
  c.font=`bold ${fs}px Courier New`; c.textAlign='right';
  c.fillStyle='rgba(0,0,0,.5)'; c.fillText(ds,rx-fs*.5+2,ry-fs*.5+2);
  c.fillStyle='#e8830a'; c.fillText(ds,rx-fs*.5,ry-fs*.5);
}

/* ═══════════════════════════════════════════════
   10. CAMERA INIT
═══════════════════════════════════════════════ */
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal:'environment' }, width:{ideal:1920}, height:{ideal:1280} },
      audio: false,
    });
    S.stream = stream; vid.srcObject = stream;
    vid.addEventListener('loadedmetadata', () => {
      S.ready = true; vid.play().catch(()=>{});
      document.getElementById('hud-res').textContent = vid.videoWidth+'×'+vid.videoHeight;
      document.getElementById('noperm').style.display = 'none';
      renderFrame();
    }, { once:true });
  } catch(e) {
    let msg = 'Kamera hiba.';
    if (e.name==='NotAllowedError') msg='Engedély megtagadva.';
    if (e.name==='NotFoundError') msg='Nincs kamera az eszközön.';
    document.getElementById('perm-err').textContent = msg;
  }
}

/* ═══════════════════════════════════════════════
   11. EVENT HANDLERS
═══════════════════════════════════════════════ */
document.getElementById('perm-btn').addEventListener('click', initCamera);

document.getElementById('shutter').addEventListener('click', () => {
  if (!S.ready) return;
  const sh = document.getElementById('shutter');
  sh.style.transform = 'scale(.9)'; setTimeout(()=>sh.style.transform='',100);
  setTimeout(()=>capture(), 40);
});

// Mode buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    S.mode = btn.dataset.mode;
    toggleGrainSize();
    updateDialDisplay();
  });
});

// Grain size slider
document.getElementById('grain-size').addEventListener('input', e => {
  S.grainSize = parseFloat(e.target.value);
  document.getElementById('gs-val').textContent = S.grainSize.toFixed(1);
});

// Date toggle
document.getElementById('date-tog').addEventListener('change', e => { S.dateStamp = e.target.checked; });

// Resize
window.addEventListener('resize', () => { vigW=0; vigH=0; });

/* ═══════════════════════════════════════════════
   12. BOOT
═══════════════════════════════════════════════ */
(async function boot() {
  buildDial();
  updateDialDisplay();

  const glc = document.getElementById('gl-canvas');
  initWebGL(glc);

  await tryLoadLutsFolder();

  if (navigator.mediaDevices?.getUserMedia) {
    initCamera();
  } else {
    document.getElementById('perm-err').textContent = 'A böngésző nem támogatja a kamera API-t.';
  }
})();
