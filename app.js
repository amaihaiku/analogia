/**
 * ANALOGIA RF-1 — app.js v3
 * Full WebGL pipeline: video → exposure → LUT → vignette → grain (single pass)
 * Canvas 2D only for capture/save
 */
'use strict';

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
const S = {
  stream: null, raf: null, ready: false,
  simKey: 'kodachrome',
  cpuLut: null,        // Float32Array for capture (CPU path)
  gpuLutTex: null,     // WebGL 3D-like texture (packed as 2D)
  lutSize: 0,
  ev: 0,               // -2..+2
  zoom: 1.0,           // 1..4
  grain: 0,            // 0..1
  grainSize: 2.0,
  vignette: 0,         // 0..1
  dateStamp: false,
  frame: 'none',
  mode: 'exposure',
  landscape: false,
};

/* ═══════════════════════════════════════════
   10 BUILT-IN FILM PROFILES
   Stored as 33³ LUT arrays, built once at startup
═══════════════════════════════════════════ */
function sCurve(x, p, c) { const t = x - p; return t / Math.sqrt(1 + (c * t) * (c * t)) + p; }
function cl(v) { return Math.max(0, Math.min(1, v)); }

// Build a 33×33×33 LUT from a per-pixel color function
// fn(r,g,b) → [r,g,b] all in 0..1
function buildLut33(fn) {
  const sz = 33, lut = new Float32Array(sz * sz * sz * 3);
  for (let bi = 0; bi < sz; bi++) for (let gi = 0; gi < sz; gi++) for (let ri = 0; ri < sz; ri++) {
    const r = ri / (sz-1), g = gi / (sz-1), b = bi / (sz-1);
    const [ro, go, bo] = fn(r, g, b);
    const idx = (bi * sz * sz + gi * sz + ri) * 3;
    lut[idx] = cl(ro); lut[idx+1] = cl(go); lut[idx+2] = cl(bo);
  }
  return { d: lut, sz };
}

const PROFILE_DEFS = {
  kodachrome: {
    name: 'KODACHROME 64', sub: 'Rich contrast · Warm reds · Cyan shadows',
    fn(r,g,b) {
      let rn=sCurve(r,.55,1.6), gn=sCurve(g,.5,1.5), bn=sCurve(b,.48,1.45);
      const l=.299*rn+.587*gn+.114*bn, sh=Math.max(0,1-l*2.5);
      rn+=l*.08; gn-=l*.02; bn-=l*.04; gn-=sh*.04; bn+=sh*.07;
      const a=(rn+gn+bn)/3;
      return [a+(rn-a)*1.25, a+(gn-a)*1.1, a+(bn-a)*1.15];
    }
  },
  fuji_superia: {
    name: 'FUJI SUPERIA 400', sub: 'Teal shadows · Soft skin · Lifted blacks',
    fn(r,g,b) {
      let rn=r*.93+.04, gn=g*.93+.04, bn=b*.93+.04;
      rn=sCurve(rn,.52,1.3); gn=sCurve(gn,.52,1.3); bn=sCurve(bn,.52,1.3);
      const l=.299*rn+.587*gn+.114*bn, sh=Math.max(0,1-l*3), hi=Math.max(0,l*2-1);
      gn+=sh*.06; bn+=sh*.05; rn-=sh*.03; rn+=hi*.04; bn-=hi*.03;
      const a=(rn+gn+bn)/3;
      return [a+(rn-a)*.9, a+(gn-a)*.92, a+(bn-a)*.88];
    }
  },
  fuji_velvia: {
    name: 'FUJI VELVIA 50', sub: 'Ultra saturated · Deep shadows · Vivid',
    fn(r,g,b) {
      let rn=sCurve(r,.5,2.2), gn=sCurve(g,.5,2.0), bn=sCurve(b,.5,1.9);
      const a=(rn+gn+bn)/3;
      rn=a+(rn-a)*1.5; gn=a+(gn-a)*1.45; bn=a+(bn-a)*1.4;
      rn+=.02; bn-=.02;
      return [rn, gn, bn];
    }
  },
  kodak_portra: {
    name: 'KODAK PORTRA 400', sub: 'Natural skin · Pastel palette · Fine grain',
    fn(r,g,b) {
      let rn=sCurve(r,.48,1.2), gn=sCurve(g,.5,1.15), bn=sCurve(b,.52,1.1);
      const l=.299*rn+.587*gn+.114*bn;
      rn+=l*.05; gn+=l*.02; bn-=l*.02;
      const a=(rn+gn+bn)/3;
      return [a+(rn-a)*.85, a+(gn-a)*.88, a+(bn-a)*.82];
    }
  },
  cinestill: {
    name: 'CINESTILL 800T', sub: 'Tungsten · Halation · Cinematic blue',
    fn(r,g,b) {
      let rn=sCurve(r*.85,.5,1.4), gn=sCurve(g*.92,.5,1.3), bn=sCurve(b*1.0+.05,.5,1.25);
      const l=.299*rn+.587*gn+.114*bn, sh=Math.max(0,1-l*2.8);
      rn+=sh*.04; gn+=sh*.02; bn+=sh*.10;
      const hi=Math.max(0,l*3-2);
      rn+=hi*.08; gn-=hi*.04;
      return [rn, gn, bn];
    }
  },
  agfa_vista: {
    name: 'AGFA VISTA 200', sub: 'Warm greens · Vintage fade · Soft',
    fn(r,g,b) {
      let rn=r*.9+.06, gn=g*.92+.04, bn=b*.85+.08;
      rn=sCurve(rn,.52,1.1); gn=sCurve(gn,.5,1.15); bn=sCurve(bn,.5,1.0);
      const a=(rn+gn+bn)/3;
      rn=a+(rn-a)*.82; gn=a+(gn-a)*.88; bn=a+(bn-a)*.75;
      return [rn, gn, bn];
    }
  },
  cross_process: {
    name: 'CROSS PROCESS', sub: 'High saturation · Shifted hues · Punchy',
    fn(r,g,b) {
      let rn=sCurve(r,.4,2.5), gn=sCurve(g,.5,2.2), bn=sCurve(b,.6,2.0);
      const a=(rn+gn+bn)/3;
      rn=a+(rn-a)*1.8; gn=a+(gn-a)*1.5; bn=a+(bn-a)*1.6;
      rn+=.04; gn+=.02; bn-=.05;
      return [rn, gn, bn];
    }
  },
  acros_std: {
    name: 'B&W ACROS', sub: 'High contrast · Optical channel mix · Rich blacks',
    fn(r,g,b) {
      let l=.35*r+.52*g+.13*b;
      l=sCurve(l,.5,2.0);
      if(l<.5) l*=.92;
      if(l>.85) l=.85+(l-.85)*.5;
      return [l,l,l];
    }
  },
  ilford_hp5: {
    name: 'ILFORD HP5', sub: 'Classic B&W · Wide latitude · Natural gray',
    fn(r,g,b) {
      let l=.299*r+.587*g+.114*b;
      l=sCurve(l,.48,1.5);
      return [l,l,l];
    }
  },
  bw_low: {
    name: 'B&W SOFT', sub: 'Low contrast · Airy · Faded blacks',
    fn(r,g,b) {
      let l=.22*r+.64*g+.14*b;
      l=sCurve(l,.5,0.8);
      l=l*.8+.10;
      return [l,l,l];
    }
  },
};

// Pre-bake all LUTs at startup (done once, off main thread feel)
const PROFILES = {};
for (const [key, def] of Object.entries(PROFILE_DEFS)) {
  PROFILES[key] = { name: def.name, sub: def.sub, lut: buildLut33(def.fn) };
}
const LOADED_LUTS = {}; // from /luts/ folder or uploaded

/* ═══════════════════════════════════════════
   CUBE PARSER
═══════════════════════════════════════════ */
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
  if (ent.length !== exp) throw new Error(`CUBE: ${ent.length}/${exp} érték`);
  return { d: new Float32Array(ent), sz };
}

/* ═══════════════════════════════════════════
   WEBGL SETUP
   Single-pass fragment shader:
   video → exposure → 3D LUT → vignette → grain
═══════════════════════════════════════════ */
const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
varying vec2 v_uv;

uniform sampler2D u_video;   // live camera frame
uniform sampler2D u_lut;     // packed 33x33x33 LUT as 2D (1089 x 33)
uniform float u_lut_size;    // 33.0
uniform float u_ev;          // exposure multiplier (linear)
uniform float u_vignette;    // 0..1
uniform float u_grain_amt;   // 0..1
uniform float u_grain_size;  // 1..8
uniform float u_time;        // seconds
uniform vec2  u_resolution;  // canvas px

// ── LUT trilinear lookup from packed 2D texture ──
vec3 applyLUT(vec3 color) {
  float sz   = u_lut_size;
  float szm1 = sz - 1.0;
  vec3 scaled = color * szm1;
  vec3 lo = floor(scaled);
  vec3 hi = min(lo + 1.0, szm1);
  vec3 t  = scaled - lo;

  // Pack: each B-slice is a (sz×sz) tile, laid out horizontally → width = sz*sz
  float sliceW = sz * sz;

  // sample helper: r→x within slice, g→y, b→slice index
  vec2 uv000 = vec2((lo.z * sz + lo.x + 0.5) / sliceW, (lo.y + 0.5) / sz);
  vec2 uv100 = vec2((lo.z * sz + hi.x + 0.5) / sliceW, (lo.y + 0.5) / sz);
  vec2 uv010 = vec2((lo.z * sz + lo.x + 0.5) / sliceW, (hi.y + 0.5) / sz);
  vec2 uv110 = vec2((lo.z * sz + hi.x + 0.5) / sliceW, (hi.y + 0.5) / sz);
  vec2 uv001 = vec2((hi.z * sz + lo.x + 0.5) / sliceW, (lo.y + 0.5) / sz);
  vec2 uv101 = vec2((hi.z * sz + hi.x + 0.5) / sliceW, (lo.y + 0.5) / sz);
  vec2 uv011 = vec2((hi.z * sz + lo.x + 0.5) / sliceW, (hi.y + 0.5) / sz);
  vec2 uv111 = vec2((hi.z * sz + hi.x + 0.5) / sliceW, (hi.y + 0.5) / sz);

  vec3 c000=texture2D(u_lut,uv000).rgb, c100=texture2D(u_lut,uv100).rgb;
  vec3 c010=texture2D(u_lut,uv010).rgb, c110=texture2D(u_lut,uv110).rgb;
  vec3 c001=texture2D(u_lut,uv001).rgb, c101=texture2D(u_lut,uv101).rgb;
  vec3 c011=texture2D(u_lut,uv011).rgb, c111=texture2D(u_lut,uv111).rgb;

  vec3 c00=mix(c000,c100,t.r), c10=mix(c010,c110,t.r);
  vec3 c01=mix(c001,c101,t.r), c11=mix(c011,c111,t.r);
  vec3 c0 =mix(c00, c10, t.g), c1 =mix(c01, c11, t.g);
  return mix(c0, c1, t.b);
}

// ── Organic grain: FBM smooth noise ──
float hash(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float smoothN(vec2 uv){vec2 i=floor(uv),f=fract(uv),u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 uv){return smoothN(uv)*.5+smoothN(uv*2.)*.25+smoothN(uv*4.)*.125;}

float grainCurve(float lum){float t=1.-abs(lum-.5)*2.;return t*t*(3.-2.*t);}

void main(){
  vec2 uv = v_uv;

  // ── Sample video ──
  vec3 col = texture2D(u_video, uv).rgb;

  // ── Exposure ──
  col = clamp(col * u_ev, 0.0, 1.0);

  // ── LUT ──
  col = applyLUT(col);

  // ── Vignette ──
  if(u_vignette > 0.0){
    vec2 d = uv - 0.5;
    d.x *= u_resolution.x / u_resolution.y; // aspect correct
    float vig = dot(d, d) * 3.5;
    col *= 1.0 - u_vignette * clamp(vig, 0.0, 1.0) * 0.88;
  }

  // ── Grain ──
  if(u_grain_amt > 0.0){
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec2 noiseUV = uv * u_resolution / (8.0 / u_grain_size) + vec2(u_time*0.17, u_time*0.13);
    float noise = fbm(noiseUV) * 2.0 - 1.0;
    float grain = noise * u_grain_amt * 0.18 * grainCurve(lum);
    col = clamp(col + grain, 0.0, 1.0);
  }

  gl_FragColor = vec4(col, 1.0);
}`;

let gl, glProg, glVideoTex, glLutTex;
const glU = {};
const glCanvas = document.getElementById('gl-canvas');

function initGL() {
  gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance' });
  if (!gl) { console.error('WebGL not supported'); return false; }

  const vs = makeShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = makeShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return false;

  glProg = gl.createProgram();
  gl.attachShader(glProg, vs); gl.attachShader(glProg, fs);
  gl.linkProgram(glProg);
  if (!gl.getProgramParameter(glProg, gl.LINK_STATUS)) { console.error('GL link', gl.getProgramInfoLog(glProg)); return false; }
  gl.useProgram(glProg);

  // Fullscreen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(glProg, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  // Uniform locations
  ['u_video','u_lut','u_lut_size','u_ev','u_vignette','u_grain_amt','u_grain_size','u_time','u_resolution'].forEach(n => {
    glU[n] = gl.getUniformLocation(glProg, n);
  });

  // Video texture
  glVideoTex = makeTex(gl.LINEAR);
  gl.uniform1i(glU.u_video, 0);

  // LUT texture (unit 1)
  glLutTex = makeTex(gl.LINEAR);
  gl.uniform1i(glU.u_lut, 1);

  return true;
}

function makeShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('GL shader', gl.getShaderInfoLog(s)); return null; }
  return s;
}

function makeTex(filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return t;
}

/* Upload a 33³ LUT as packed 2D texture: width=33*33=1089, height=33
   Layout: each row = one G slice; each 33-wide block in a row = one B slice */
function uploadLutTexture(lutData) {
  const sz = lutData.sz;
  const W = sz * sz, H = sz;
  // Build RGBA Uint8 for the texture
  const rgba = new Uint8Array(W * H * 4);
  const lut = lutData.d;
  for (let bi = 0; bi < sz; bi++) {
    for (let gi = 0; gi < sz; gi++) {
      for (let ri = 0; ri < sz; ri++) {
        const lutIdx = (bi * sz * sz + gi * sz + ri) * 3;
        // Packed 2D coords: x = bi*sz + ri,  y = gi
        const texIdx = (gi * W + bi * sz + ri) * 4;
        rgba[texIdx]   = Math.round(lut[lutIdx]   * 255);
        rgba[texIdx+1] = Math.round(lut[lutIdx+1] * 255);
        rgba[texIdx+2] = Math.round(lut[lutIdx+2] * 255);
        rgba[texIdx+3] = 255;
      }
    }
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glLutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  S.lutSize = sz;
  gl.uniform1f(glU.u_lut_size, sz);
}

/* ═══════════════════════════════════════════
   RENDER LOOP (pure WebGL, 60fps)
═══════════════════════════════════════════ */
const vid = document.getElementById('vid');

function renderFrame() {
  S.raf = requestAnimationFrame(renderFrame);
  if (!S.ready || vid.readyState < 2) return;

  // Sync canvas size to bezel element
  const bezel = glCanvas.parentElement;
  const bw = bezel.clientWidth | 0;
  const bh = bezel.clientHeight | 0;
  if (glCanvas.width !== bw || glCanvas.height !== bh) {
    glCanvas.width = bw; glCanvas.height = bh;
    gl.viewport(0, 0, bw, bh);
  }

  // Upload video frame to texture unit 0
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, glVideoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);

  // Set uniforms
  gl.uniform1f(glU.u_ev,         Math.pow(2, S.ev));
  gl.uniform1f(glU.u_vignette,   S.vignette);
  gl.uniform1f(glU.u_grain_amt,  S.grain);
  gl.uniform1f(glU.u_grain_size, S.grainSize);
  gl.uniform1f(glU.u_time,       performance.now() / 1000);
  gl.uniform2f(glU.u_resolution, glCanvas.width, glCanvas.height);

  // Draw fullscreen quad
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/* ═══════════════════════════════════════════
   DIAL SYSTEM
═══════════════════════════════════════════ */
const MODES = {
  exposure: { min:-2,   max:2,   step:.1,  def:0,   fmt:v=>(v>=0?'+':'')+v.toFixed(1)+' EV' },
  zoom:     { min:1.0,  max:4.0, step:.1,  def:1.0, fmt:v=>v.toFixed(1)+'×' },
  grain:    { min:0,    max:1,   step:.05, def:0,   fmt:v=>Math.round(v*100)+'%' },
  vignette: { min:0,    max:1,   step:.05, def:0,   fmt:v=>Math.round(v*100)+'%' },
};

const TICK_GAP = 12; // px between ticks
const TICK_COUNT = 60;
let dialDrag = false, dialLast = 0, dialOffset = 0;

function getModeVal() {
  return { exposure:S.ev, zoom:S.zoom, grain:S.grain, vignette:S.vignette }[S.mode];
}
function setModeVal(v) {
  const m = MODES[S.mode];
  v = Math.max(m.min, Math.min(m.max, Math.round(v / m.step) * m.step));
  switch(S.mode) {
    case 'exposure': S.ev = v; break;
    case 'zoom':     S.zoom = v; break;
    case 'grain':    S.grain = v; break;
    case 'vignette': S.vignette = v; break;
  }
  return v;
}

function offsetFromVal(v) {
  const m = MODES[S.mode];
  return -(v - m.def) / (m.max - m.min) * TICK_COUNT * TICK_GAP;
}
function valFromOffset(o) {
  const m = MODES[S.mode];
  return m.def - o / (TICK_COUNT * TICK_GAP) * (m.max - m.min);
}

function buildDials() {
  [document.getElementById('dial-ticks-p'), document.getElementById('dial-ticks-l')].forEach((el, idx) => {
    if (!el) return;
    el.innerHTML = '';
    const isV = idx === 1; // vertical for landscape
    for (let i = 0; i < TICK_COUNT; i++) {
      const t = document.createElement('div');
      const isMaj = i % 5 === 0, isZ = i === TICK_COUNT / 2;
      if (isV) {
        t.className = 'dial-tick-v' + (isMaj ? ' major' : '') + (isZ ? ' zero' : '');
      } else {
        t.className = 'dial-tick' + (isMaj ? ' major' : '') + (isZ ? ' zero' : '');
        const h = isMaj ? 24 : 14;
        t.style.cssText = `height:${h}px;margin:0 ${TICK_GAP/2}px`;
      }
      el.appendChild(t);
    }
  });
}

function syncDialVisual() {
  const off = offsetFromVal(getModeVal());
  dialOffset = off;
  const ticksP = document.getElementById('dial-ticks-p');
  const ticksL = document.getElementById('dial-ticks-l');
  if (ticksP) ticksP.style.transform = `translateX(${off}px)`;
  if (ticksL) ticksL.style.transform = `translateY(${off}px)`;
  const m = MODES[S.mode];
  document.getElementById('hud-mode-val').textContent = m.fmt(getModeVal());
  document.getElementById('hud-mode-name').textContent = S.mode.toUpperCase();
  if (S.mode === 'exposure') document.getElementById('hud-ev').textContent = m.fmt(S.ev);
  if (S.mode === 'zoom') document.getElementById('hud-zoom').textContent = S.zoom.toFixed(1)+'×';
}

function onDialMove(delta) {
  // delta: positive = right/down = increase
  dialOffset += delta;
  const raw = valFromOffset(dialOffset);
  const v = setModeVal(raw);
  const m = MODES[S.mode];
  // clamp offset to bounds
  dialOffset = offsetFromVal(v);
  const ticksP = document.getElementById('dial-ticks-p');
  const ticksL = document.getElementById('dial-ticks-l');
  if (ticksP) ticksP.style.transform = `translateX(${dialOffset}px)`;
  if (ticksL) ticksL.style.transform = `translateY(${dialOffset}px)`;
  document.getElementById('hud-mode-val').textContent = m.fmt(v);
  if (S.mode === 'exposure') document.getElementById('hud-ev').textContent = m.fmt(v);
  if (S.mode === 'zoom') document.getElementById('hud-zoom').textContent = v.toFixed(1)+'×';
}

// Attach drag events to both dials (portrait horizontal, landscape vertical)
function attachDialEvents(el, vertical) {
  if (!el) return;
  el.addEventListener('pointerdown', e => {
    dialDrag = true; dialLast = vertical ? e.clientY : e.clientX;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!dialDrag) return;
    const cur = vertical ? e.clientY : e.clientX;
    const delta = vertical ? cur - dialLast : cur - dialLast;
    dialLast = cur;
    onDialMove(delta);
    e.preventDefault();
  });
  el.addEventListener('pointerup',   () => { dialDrag = false; });
  el.addEventListener('pointercancel',() => { dialDrag = false; });
}

/* ═══════════════════════════════════════════
   FOCUS: TAP-TO-FOCUS on preview
═══════════════════════════════════════════ */
function setupFocusOverlay() {
  const overlay = document.getElementById('focus-overlay');
  const ring    = document.getElementById('focus-ring');

  overlay.addEventListener('click', async e => {
    const rect = overlay.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top)  / rect.height;

    // Show focus ring at tap position
    ring.style.left = (rx * 100) + '%';
    ring.style.top  = (ry * 100) + '%';
    ring.classList.remove('hidden');
    setTimeout(() => ring.classList.add('hidden'), 1200);

    // Try hardware tap-to-focus via pointsOfInterest
    if (!S.stream) return;
    const track = S.stream.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual', pointsOfInterest: [{ x: rx, y: ry }] }] });
    } catch(_) {
      // fallback: try continuous
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch(__) {}
    }
    document.getElementById('hud-focus-label').textContent = `MF`;
    setTimeout(() => document.getElementById('hud-focus-label').textContent = 'AF', 2000);
  });
}

/* ═══════════════════════════════════════════
   FILM MODAL
═══════════════════════════════════════════ */
async function tryLoadLutsFolder() {
  try {
    const res = await fetch('luts/index.json');
    if (!res.ok) return;
    const json = await res.json();
    for (const entry of (json.luts || [])) {
      try {
        const r2 = await fetch(`luts/${entry.file}`);
        if (!r2.ok) continue;
        const txt = await r2.text();
        const lut = parseCube(txt);
        LOADED_LUTS[entry.file] = { d: lut.d, sz: lut.sz, name: entry.name || entry.file, sub: entry.sub || 'Custom LUT' };
      } catch(e) { console.warn('LUT skip:', entry.file, e); }
    }
  } catch(_) {}
}

function buildFilmList() {
  const list = document.getElementById('film-list');
  list.innerHTML = '';

  // Built-in profiles
  for (const [key, prof] of Object.entries(PROFILES)) {
    const isActive = S.simKey === key && !S.cpuLut;
    const item = document.createElement('div');
    item.className = 'film-item' + (isActive ? ' active' : '');
    item.innerHTML = `<div class="film-dot"></div><div><div class="film-name">${prof.name}</div><div class="film-sub">${prof.sub}</div></div>`;
    item.addEventListener('click', () => {
      S.simKey = key; S.cpuLut = null;
      uploadLutTexture(prof.lut);
      document.getElementById('film-label').textContent = prof.name;
      closeModal();
    });
    list.appendChild(item);
  }

  // External LUTs
  for (const [fname, lut] of Object.entries(LOADED_LUTS)) {
    const item = document.createElement('div');
    item.className = 'film-item';
    item.innerHTML = `<div class="film-dot"></div><div><div class="film-name">${lut.name}</div><div class="film-sub">${lut.sub}</div></div>`;
    item.addEventListener('click', () => {
      S.simKey = '__lut__'; S.cpuLut = lut;
      uploadLutTexture(lut);
      document.getElementById('film-label').textContent = lut.name;
      closeModal();
    });
    list.appendChild(item);
  }
}

function openModal()  { buildFilmList(); document.getElementById('film-modal').classList.remove('hidden'); }
function closeModal() { document.getElementById('film-modal').classList.add('hidden'); }

document.getElementById('film-btn').addEventListener('click', openModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', closeModal);
document.getElementById('lut-upload').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const lut = parseCube(await file.text());
    const name = file.name.replace('.cube','').replace(/_/g,' ').toUpperCase();
    LOADED_LUTS[file.name] = { d: lut.d, sz: lut.sz, name, sub: 'Egyéni LUT · .cube' };
    S.simKey = '__lut__'; S.cpuLut = LOADED_LUTS[file.name];
    uploadLutTexture(lut);
    document.getElementById('film-label').textContent = name;
    closeModal();
  } catch(err) { alert('LUT hiba: ' + err.message); }
  e.target.value = '';
});

/* ═══════════════════════════════════════════
   CAPTURE (CPU path, native video resolution)
═══════════════════════════════════════════ */
function c255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function cpuApplyLUT(r, g, b, lutData) {
  const { d, sz } = lutData;
  const sc = (sz-1), rf = r/255*sc, gf = g/255*sc, bf = b/255*sc;
  const r0=Math.floor(rf),r1=Math.min(r0+1,sz-1);
  const g0=Math.floor(gf),g1=Math.min(g0+1,sz-1);
  const b0=Math.floor(bf),b1=Math.min(b0+1,sz-1);
  const dr=rf-r0, dg=gf-g0, db=bf-b0;
  function idx(a,c,dd){return(dd*sz*sz+c*sz+a)*3}
  const out=[];
  for(let ch=0;ch<3;ch++){
    const v000=d[idx(r0,g0,b0)+ch],v100=d[idx(r1,g0,b0)+ch];
    const v010=d[idx(r0,g1,b0)+ch],v110=d[idx(r1,g1,b0)+ch];
    const v001=d[idx(r0,g0,b1)+ch],v101=d[idx(r1,g0,b1)+ch];
    const v011=d[idx(r0,g1,b1)+ch],v111=d[idx(r1,g1,b1)+ch];
    const c00=v000+(v100-v000)*dr, c10=v010+(v110-v010)*dr;
    const c01=v001+(v101-v001)*dr, c11=v011+(v111-v011)*dr;
    const c0=c00+(c10-c00)*dg,     c1=c01+(c11-c01)*dg;
    out.push((c0+(c1-c0)*db)*255);
  }
  return out;
}

function capture() {
  const vw = vid.videoWidth, vh = vid.videoHeight;
  if (!vw || !vh) return;
  const targetAR = 3/2;
  let outW = vw, outH = vh;
  if (outW/outH > targetAR) outW = Math.round(outH * targetAR);
  else outH = Math.round(outW / targetAR);

  const frame = document.getElementById('frame-sel-p').value !== 'none'
    ? document.getElementById('frame-sel-p').value
    : document.getElementById('frame-sel-l').value;

  let cw=outW, ch=outH, cx=0, cy=0;
  const ps=Math.round(outW*.05), pb=Math.round(outW*.18), sh=Math.round(outH*.13);
  if (frame==='polaroid'){cw=outW+ps*2;ch=outH+ps+pb;cx=ps;cy=ps;}
  else if(frame==='film'){ch=outH+sh*2;cy=sh;}

  const sv = document.getElementById('save-canvas');
  sv.width=cw; sv.height=ch;
  const sc = sv.getContext('2d');

  if(frame==='polaroid'){sc.fillStyle='#f4f0e8';sc.fillRect(0,0,cw,ch);}
  else if(frame==='film'){drawFilm(sc,cw,ch,sh);}
  else{sc.fillStyle='#000';sc.fillRect(0,0,cw,ch);}

  // Render video to temp canvas at native res
  const tmp=document.createElement('canvas'); tmp.width=outW; tmp.height=outH;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  const ar=vw/vh;
  let dw,dh;
  if(ar>targetAR){dh=outH;dw=dh*ar;}else{dw=outW;dh=dw/ar;}
  tc.drawImage(vid,(outW-dw)/2,(outH-dh)/2,dw,dh);

  // CPU pixel pipeline (for saved file)
  const id=tc.getImageData(0,0,outW,outH), pd=id.data;
  const evm=Math.pow(2,S.ev), va=S.vignette;

  // Pick LUT for CPU: active profile or custom
  const lutData = (S.simKey === '__lut__' && S.cpuLut) ? S.cpuLut : PROFILES[S.simKey]?.lut;

  // Vignette LUT
  const vl=new Float32Array(outW*outH);
  const mx=Math.sqrt((outW/2)**2+(outH/2)**2);
  for(let y=0;y<outH;y++) for(let x=0;x<outW;x++){
    const dx=(x-outW/2)/mx, dy=(y-outH/2)/mx;
    vl[y*outW+x]=dx*dx+dy*dy;
  }

  for(let i=0;i<pd.length;i+=4){
    const pi=i>>2;
    let r=Math.min(255,pd[i]*evm), g=Math.min(255,pd[i+1]*evm), b=Math.min(255,pd[i+2]*evm);
    if (lutData) {
      const rgb=cpuApplyLUT(r,g,b,lutData);
      r=rgb[0]; g=rgb[1]; b=rgb[2];
    }
    if(va>0){const vm=1-va*vl[pi]*.88; r*=vm; g*=vm; b*=vm;}
    pd[i]=c255(r); pd[i+1]=c255(g); pd[i+2]=c255(b);
  }
  tc.putImageData(id,0,0);
  sc.drawImage(tmp,cx,cy,outW,outH);

  const dateOn = document.getElementById('date-tog').checked || document.getElementById('date-tog-l').checked;
  if(dateOn) burnDate(sc,cx+outW,cy+outH);
  if(frame==='polaroid'){
    sc.fillStyle='#5a5040';
    sc.font=`bold ${Math.round(ch*.024)}px Courier New`;
    sc.textAlign='center';
    sc.fillText('ANALOGIA RF-1',cw/2,ch-Math.round(ch*.03));
  }

  sv.toBlob(blob=>{
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url;
    const now=new Date(),p=n=>String(n).padStart(2,'0');
    const nm=(PROFILES[S.simKey]?.name||document.getElementById('film-label').textContent||'CUSTOM').replace(/ /g,'_').replace(/&/g,'');
    a.download=`ANALOGIA_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.jpg`;
    a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
  },'image/jpeg',.95);
}

function drawFilm(c,W,H,sh){
  c.fillStyle='#111008';c.fillRect(0,0,W,H);
  [0,H-sh].forEach(sy=>{
    c.fillStyle='#1e1c17';c.fillRect(0,sy,W,sh);
    const hw=Math.round(sh*.5),hh=Math.round(sh*.55),sp=hw*2.2,hy=sy+(sh-hh)/2;
    c.fillStyle='#0a0904';
    let x=sp*.25;
    while(x<W-hw){
      c.beginPath();
      if(c.roundRect) c.roundRect(x,hy,hw,hh,3); else c.rect(x,hy,hw,hh);
      c.fill(); x+=sp;
    }
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

/* ═══════════════════════════════════════════
   CAMERA INIT
═══════════════════════════════════════════ */
async function initCamera() {
  const constraints = {
    video: { facingMode: { ideal:'environment' }, width:{ideal:1920}, height:{ideal:1080} },
    audio: false,
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    S.stream = stream; vid.srcObject = stream;
    vid.addEventListener('loadedmetadata', () => {
      S.ready = true; vid.play().catch(()=>{});
      document.getElementById('hud-res').textContent = vid.videoWidth+'×'+vid.videoHeight;
      document.getElementById('noperm').style.display = 'none';
      // Start trying to use continuous AF
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(()=>{});
      }
      renderFrame();
    }, { once:true });
  } catch(e) {
    let msg='Kamera hiba.';
    if(e.name==='NotAllowedError') msg='Engedély megtagadva.';
    if(e.name==='NotFoundError') msg='Nincs kamera az eszközön.';
    document.getElementById('perm-err').textContent = msg;
  }
}

/* ═══════════════════════════════════════════
   EVENT HANDLERS
═══════════════════════════════════════════ */
document.getElementById('perm-btn').addEventListener('click', initCamera);

// Shutter buttons (portrait + landscape)
['shutter-p','shutter-l'].forEach(id => {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!S.ready) return;
    btn.querySelector('.sh-core').style.transform='scale(.9)';
    setTimeout(()=>btn.querySelector('.sh-core').style.transform='', 100);
    setTimeout(()=>capture(), 40);
  });
});

// Mode buttons (both portrait and landscape sets)
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    // activate all buttons with same data-mode
    document.querySelectorAll(`.mode-btn[data-mode="${btn.dataset.mode}"]`).forEach(b=>b.classList.add('active'));
    S.mode = btn.dataset.mode;
    syncDialVisual();
  });
});

// Frame select sync
['frame-sel-p','frame-sel-l'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', e => {
    S.frame = e.target.value;
    ['frame-sel-p','frame-sel-l'].forEach(oid => {
      const o = document.getElementById(oid);
      if (o && o !== el) o.value = e.target.value;
    });
  });
});

window.addEventListener('resize', () => {
  // Re-sync dial offset after layout change
  syncDialVisual();
});

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
(async function boot() {
  if (!initGL()) {
    document.getElementById('perm-err').textContent = 'WebGL nem elérhető a böngészőben.';
    return;
  }

  buildDials();
  attachDialEvents(document.getElementById('dial-wrap-p'), false);
  attachDialEvents(document.getElementById('dial-wrap-l'), true);
  setupFocusOverlay();
  syncDialVisual();

  // Load default LUT (kodachrome)
  uploadLutTexture(PROFILES['kodachrome'].lut);

  // Try loading /luts/ folder
  await tryLoadLutsFolder();

  if (navigator.mediaDevices?.getUserMedia) {
    initCamera();
  } else {
    document.getElementById('perm-err').textContent = 'A böngésző nem támogatja a kamera API-t.';
  }
})();
