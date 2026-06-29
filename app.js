'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v34 (PER-KEY FOCUS LOCK)
═══════════════════════════════════════ */
console.log('ANALOGIA app.js v34 betöltve');

const PROF = {};

const S={
  stream:null,raf:null,ready:false,saving:false,
  frozen:false, // élőkép befagyasztva (felbontásváltás kritikus szakasza alatt)
  focusLock:null, // {x,y} videó-koordinátában: ide zárt AE/AF, amíg máshová nem koppintanak
  aeBias:0, // szoftveres fénymérés-zár: digitális EV-korrekció a koppintott pontra
  lockedFocusDistance:null, // betonozott manuális fókusztávolság (zár alatt)
  simKey:'kodachrome',
  exposure:0,shadows:0,highlights:0,tone:0,grain:0,grainSize:2,vignette:0,
  zoom:1.0,
  mode:'exposure',
  vidW:1,vidH:1,
  lastPhotoUrl:null,
  deActive: false,    
  deStage: 0          
};

let videoDevices = [];
let currentDeviceIndex = 0;
let deferredPrompt = null;

// Az élőkép ALACSONY felbontáson fut, hogy ne késsen (a nagy videó textúra-
// feltöltése képkockánként drága). Exponáláskor a stream ideiglenesen
// CAPTURE_RES-re vált, lekapjuk a frame-et, majd visszaváltunk.
const PREVIEW_RES = 720;
// Mentéskor kért stream-felbontás. Szándékosan mérsékelt: a túl nagy forrás
// "digitálisan éles" képet ad, ami öli az analóg karaktert, és a váltás is lassabb.
const CAPTURE_RES = 1600;
// A mentett fájl mérete (négyzet). Köztes érték a 720-as előnézet és a forrás
// között: zoomolásnál még használható, de megmarad az analóg lágyság.
const SAVE_RES = 1280;

let activeBlobUrl = null;
let activeFilename = "";
let flashEnabled = false;
let onVidMeta = null; // az aktuális loadedmetadata handler – gyors kameraváltásnál le kell szedni a régit

// Teljesítmény-optimalizálás: Méretek gyorsítótárazása a Reflow elkerülésére
let cachedCanvasW = 0;
let cachedCanvasH = 0;

const vid = document.getElementById('vid');
const glCv = document.getElementById('gl-canvas');

// Globálisan újrahasznosított canvasok a capture memóriaszivárgásának megakadályozására
let memoTmpCanvas = null;
let memoSrcCanvas = null;

/* ── DIAGNOSZTIKA ──
   Bekapcsolás: ?debug=1 az URL-ben, VAGY 7 gyors koppintás az ANALOGIA feliratra
   (telepített PWA-ban ez utóbbi az út, mert oda nem lehet URL-paramétert adni).
   A napló a háttérben MINDIG gyűjt (~250 sor), így bekapcsoláskor a korábbi
   események is megjelennek – nem kell újra előidézni a hibát. */
let DIAG = /[?&]debug=1/.test(location.search);
let diagEl = null;
const diagBuf = [];
function renderDiag(){
  if (!diagEl) {
    diagEl = document.createElement('div');
    diagEl.style.cssText = 'position:fixed;left:4px;right:4px;bottom:4px;max-height:36vh;overflow:auto;z-index:99999;background:rgba(0,0,0,.88);color:#7CFC00;font:10px/1.5 monospace;padding:6px;border:1px solid #555;white-space:pre-wrap;pointer-events:none';
    document.body.appendChild(diagEl);
  }
  diagEl.textContent = diagBuf.join('\n') + '\n';
  diagEl.scrollTop = diagEl.scrollHeight;
}
function dlog(msg){
  diagBuf.push('[' + (performance.now()/1000).toFixed(1) + '] ' + msg);
  if (diagBuf.length > 250) diagBuf.shift();
  try { console.log('[DIAG]', msg); } catch(_) {}
  if (DIAG) renderDiag();
}
function toggleDiag(){
  DIAG = !DIAG;
  if (DIAG) { renderDiag(); showToast('Diagnosztika BE'); }
  else if (diagEl) { diagEl.remove(); diagEl = null; showToast('Diagnosztika KI'); }
}
window.addEventListener('error', e => dlog('JS HIBA: ' + e.message + ' @' + String(e.filename||'').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => dlog('PROMISE HIBA: ' + ((e.reason && e.reason.message) || e.reason)));

function showToast(msg) {
  let t = document.getElementById('anal-toast');
  if(!t) {
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

function checkStandaloneGuard() {
  const urlParams = new URLSearchParams(window.location.search);
  // A ?debug=1 is átmegy a kapun: diagnosztikához böngészőből is megnyitható
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

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

function cl(v){return Math.max(0,Math.min(1,v));}
function bake(fn){
  const N=33,lut=new Float32Array(N*N*N*3);
  for(let bi=0;bi<N;bi++)for(let gi=0;gi<N;gi++)for(let ri=0;ri<N;ri++){
    const[ro,go,bo]=fn(ri/(N-1),gi/(N-1),bi/(N-1));
    const i=(bi*N*N+gi*N+ri)*3;lut[i]=cl(ro);lut[i+1]=cl(go);lut[i+2]=cl(bo);
  }
  return{d:lut,sz:N};
}

// 3D LUT (.cube) Fájl Értelmező
function parseCube(text) {
  const lines = text.split('\n');
  let size = 0;
  const data = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    
    if (line.startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/);
      size = parseInt(parts[1], 10);
      continue;
    }
    if (line.startsWith('TITLE') || line.startsWith('DOMAIN_MIN') || line.startsWith('DOMAIN_MAX')) {
      continue;
    }
    
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        data.push(r, g, b);
      }
    }
  }
  return { d: new Float32Array(data), sz: size };
}

async function loadExternalFilters() {
  let filters = [];
  try {
    const res = await fetch('filters/index.json');
    filters = await res.json();
  } catch(e) {
    console.warn('filters/index.json nem tölthető be:', e);
    return;
  }

  // A párhuzamos betöltés miatt a beérkezési sorrend véletlenszerű lenne –
  // ezért előbb ide gyűjtünk, és a végén az index.json sorrendje szerint
  // töltjük fel a PROF-ot. Így a filmlista sorrendje mindig kiszámítható,
  // és az index.json átrendezésével szabadon kurálható.
  const loaded = {};

  const promises = filters.map(f => {
    const isCube = (typeof f === 'object' && f.type === 'cube');
    const id = typeof f === 'string' ? f : f.id;
    
    if (isCube) {
      return fetch(`filters/${id}.cube`)
        .then(res => res.text())
        .then(text => {
          const lut = parseCube(text);
          if (lut.sz > 0) {
            loaded[id] = {
              name: f.name || id,
              sub: f.sub || "3D LUT",
              lut: lut,
              isBW: !!f.isBW
            };
          }
        })
        .catch(e => console.warn(`.cube betöltési hiba (${id}):`, e));
    } else {
      return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `filters/${id}.js`;
        script.onload = () => {
          if (window.PD && window.PD[id]) {
            loaded[id] = {
              name: window.PD[id].name,
              sub: window.PD[id].sub,
              lut: bake(window.PD[id].fn),
              isBW: window.PD[id].isBW || false
            };
          }
          resolve();
        };
        script.onerror = resolve;
        document.head.appendChild(script);
      });
    }
  });
  await Promise.all(promises);

  // Determinisztikus sorrend: az index.json sorrendjében
  for (const f of filters) {
    const id = typeof f === 'string' ? f : f.id;
    if (loaded[id]) PROF[id] = loaded[id];
  }
}

/* ── WebGL Engine ── */
const VS=`attribute vec2 a_pos;varying vec2 v_uv;
void main(){v_uv=vec2(a_pos.x*.5+.5,.5-a_pos.y*.5);gl_Position=vec4(a_pos,0.,1.);}`;

const FS=`#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_vid_tex;uniform sampler2D u_lut_tex;uniform sampler2D u_de_tex;
uniform float u_lut_sz;uniform vec2 u_cvs_sz;uniform vec2 u_vid_sz;
uniform float u_zoom;uniform float u_ev;uniform float u_vig;
uniform float u_shadows;uniform float u_highlights;uniform float u_tone;
uniform float uGrainIntensity;
uniform float uGrainSize;
uniform float uTime;
uniform float uIsBW;
uniform float u_de_active; 

uniform float u_fx_active;
uniform float u_fx_intensity;
uniform float u_fx_scale;
uniform float u_fx_stretch;
uniform float u_fx_angle;
uniform float u_fx_overexposure;
uniform float u_fx_hue;
uniform vec2 u_fx_position;
uniform float u_fx_seed;
uniform float u_fx_bw;
uniform float u_fx_quality;

vec2 cropUV(vec2 uv){
  float cAR=u_cvs_sz.x/u_cvs_sz.y,vAR=u_vid_sz.x/u_vid_sz.y;
  vec2 sc=vec2(1.);
  if(vAR>cAR)sc.x=cAR/vAR; else sc.y=vAR/cAR;
  sc/=u_zoom;
  return(uv-.5)*sc+.5;
}
vec3 applyLUT(vec3 c){
  float sz=u_lut_sz,sm=sz-1.;
  vec3 s=clamp(c,0.,1.)*sm,lo=floor(s),hi=min(lo+1.,sm),t=s-lo;
  float W=sz*sz;
  #define S2(R,G,B) vec2(((B)*sz+(R)+.5)/W,((G)+.5)/sz)
  vec3 c000=texture2D(u_lut_tex,S2(lo.r,lo.g,lo.b)).rgb,c100=texture2D(u_lut_tex,S2(hi.r,lo.g,lo.b)).rgb;
  vec3 c010=texture2D(u_lut_tex,S2(lo.r,hi.g,lo.b)).rgb,c110=texture2D(u_lut_tex,S2(hi.r,hi.g,lo.b)).rgb;
  vec3 c001=texture2D(u_lut_tex,S2(lo.r,lo.g,hi.b)).rgb,c101=texture2D(u_lut_tex,S2(hi.r,lo.g,hi.b)).rgb;
  vec3 c011=texture2D(u_lut_tex,S2(lo.r,hi.g,hi.b)).rgb,c111=texture2D(u_lut_tex,S2(hi.r,hi.g,hi.b)).rgb;
  vec3 c00=mix(c000,c100,t.r),c10=mix(c010,c110,t.r),c01=mix(c001,c101,t.r),c11=mix(c011,c111,t.r);
  return mix(mix(c00,c10,t.g),mix(c01,c11,t.g),t.b);
}
float hash3D(vec3 p){p=fract(p*vec3(443.8975,397.2973,491.1871));p+=dot(p.xyz,p.yzx+19.19);return fract(p.x*p.y*p.z);}
float noise3D(vec3 p){vec3 i=floor(p);vec3 f=fract(p);vec3 fp=f*f*(3.0-2.0*f);return mix(mix(mix(hash3D(i+vec3(0.,0.,0.)),hash3D(i+vec3(1.,0.,0.)),fp.x),mix(hash3D(i+vec3(0.,1.,0.)),hash3D(i+vec3(1.,1.,0.)),fp.x),fp.y),mix(mix(hash3D(i+vec3(0.,0.,1.)),hash3D(i+vec3(1.,0.,1.)),fp.x),mix(hash3D(i+vec3(0.,1.,1.)),hash3D(i+vec3(1.,1.,1.)),fp.x),fp.y),fp.z);}
float softLight(float base,float blend){return(blend<0.5)?(base-(1.0-2.0*blend)*base*(1.0-base)):(base+(2.0*blend-1.0)*(sqrt(base)-base));}

// LÁGY FÉNY-TÉRDHAJLÍTÁS (soft knee / highlight rolloff).
// KNEE küszöb alatt: pontosan x (identitás) -> sötét és középtónusok érintetlenek.
// KNEE fölött: a (KNEE, +∞) tartományt aszimptotikusan a (KNEE, 1.0) sávba telíti,
// így az eredmény SOHA nem éri el az 1.0-t (a tiszta fehér kivételével), tehát
// a csúcsfények nem éghetnek sík fehérré, a részletek megmaradnak.
float soft_knee1(float x){
  const float KNEE = 0.7;            // eddig lineáris (érintetlen) a jel
  if (x <= KNEE) return x;
  float over = x - KNEE;             // a küszöb fölötti rész
  float room = 1.0 - KNEE;           // ennyi hely maradt a fehérig
  // telítődő leképezés: over∈[0,∞) -> [0,room), aszimptota = 1.0
  return KNEE + room * (over / (over + room));
}
vec3 soft_knee(vec3 c){ return vec3(soft_knee1(c.r), soft_knee1(c.g), soft_knee1(c.b)); }

${window.FX && window.FX.shader ? window.FX.shader.helpers : ''}

void main(){
  vec2 vuv = cropUV(v_uv);
  vuv = clamp(vuv, 0.0, 1.0); 
  
  vec3 srgbIn = texture2D(u_vid_tex,vuv).rgb;
  // EV alkalmazása + LÁGY FÉNY-TÉRDHAJLÍTÁS (soft knee).
  // A "* u_ev" szorzás a fényeket 1.0 fölé löki, amit a clamp sík fehérré éget.
  // A soft_knee() a küszöb (KNEE) ALATT pontosan IDENTITÁS — a sötét és
  // középtónusok teljesen érintetlenek, a kép alapból ugyanúgy néz ki, mint eddig.
  // A küszöb FÖLÖTT a fényeket aszimptotikusan az 1.0-hoz telíti, így a beégés
  // matematikailag lehetetlen, de a csúcsfény-részletek megmaradnak.
  vec3 linA = soft_knee(pow(srgbIn, vec3(2.2)) * u_ev);
  vec3 linear = linA;
  
  if(u_de_active > 0.5) {
    vec3 srgbFirst = texture2D(u_de_tex, vuv).rgb;
    vec3 linB = soft_knee(pow(srgbFirst, vec3(2.2)) * u_ev);
    linear = 1.0 - ((1.0 - clamp(linA, 0.0, 1.0)) * (1.0 - clamp(linB, 0.0, 1.0)));
  }
  
  float linLum = dot(linear, vec3(0.2126, 0.7152, 0.0722));
  
  float shadowMask = 1.0 - smoothstep(0.0, 0.4, linLum);
  float shadowFactor = 1.0 - u_shadows * 0.5;
  linear = mix(linear, pow(clamp(linear, 0.0, 1.0), vec3(shadowFactor)), shadowMask);
  
  // TÜKRÖZÖTT GAMMA: a sima pow a fehér közelében szinte hatástalan (ezért tűnt
  // a HIGH csúszka halottnak). A fényeket az INVERTÁLT kép "árnyékaiként" kezeljük:
  // ott a pow erős, visszafordítás után pedig pont a fehér közelében hat a legjobban,
  // és pozitív irányban sem éghet ki, csak aszimptotikusan közelíti a fehéret.
  float highlightMask = smoothstep(0.15, 0.9, linLum);
  float hlFactor = 1.0 + u_highlights * 0.6; // + : fények kihúzása, − : tompítás/recovery
  // --- ÚJ, BIZTONSÁGOS KÓD ---
  // A max() függvénnyel garantáljuk, hogy sosem lesz tökéletes nulla az alap
  vec3 invc = max(1.0 - clamp(linear, 0.0, 1.0), 0.00001);
  vec3 hlAdj = 1.0 - pow(invc, vec3(hlFactor));
  linear = mix(linear, hlAdj, highlightMask);
  
  vec3 srgbProcessed = pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 col = applyLUT(srgbProcessed);
  
  col.r+=u_tone*0.12;
  col.g+=u_tone*0.04;
  col.b-=u_tone*0.15;
  col=clamp(col,0.0,1.0);
  
  // FX (fényszivárgás) a képernyő-koordinátán fut, NEM a zoomolt vuv-on.
  // Így nagyításkor sem tűnik el, és a mentett képen is ugyanúgy látszik.
  vec2 vuv_saved=vuv; vuv=v_uv;
  ${window.FX && window.FX.shader ? window.FX.shader.calculation : ''}
  vuv=vuv_saved;
  
  if(abs(u_vig)>0.001){
    vec2 d=(v_uv-.5)*2.;
    float vig=smoothstep(.3,2.0,dot(d,d));
    if(u_vig>0.){
      col*=1.-u_vig*vig*.88;            // klasszikus sötétedő szél
    } else {
      // világosodó szél (fakult nyomat / fénybeszivárgás) – visszafogottabb
      // maximummal, mert hamar "ködössé" válna
      col=mix(col,vec3(1.),min(1.,-u_vig*vig*.5));
    }
  }
  
  if(uGrainIntensity>0.0){
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    float midtoneMask=4.0*lum*(1.0-lum);
    float t24=floor(uTime*24.0)/24.0;
    vec2 px=(v_uv*u_cvs_sz)/uGrainSize;
    if(uIsBW>0.5){
      // BW: egyforma luma-zaj mind a 3 csatornára soft-light-tal.
      // col.g/col.b NEM felülírt, ezért a tone (meleg/hideg tónus) megmarad.
      float noiseVal=noise3D(vec3(px,t24));
      float grainAmt=uGrainIntensity*midtoneMask;
      col.r=softLight(col.r,mix(0.5,noiseVal,grainAmt));
      col.g=softLight(col.g,mix(0.5,noiseVal,grainAmt));
      col.b=softLight(col.b,mix(0.5,noiseVal,grainAmt));
    } else {
      float nR=noise3D(vec3(px,t24));
      float nG=noise3D(vec3(px+vec2(12.34,56.78),t24));
      float nB=noise3D(vec3(px+vec2(89.12,34.56),t24));
      col.r=clamp(col.r+(nR-0.5)*uGrainIntensity*midtoneMask,0.0,1.0);
      col.g=clamp(col.g+(nG-0.5)*uGrainIntensity*midtoneMask,0.0,1.0);
      col.b=clamp(col.b+(nB-0.5)*uGrainIntensity*1.6*midtoneMask,0.0,1.0);
    }
  }
  
  gl_FragColor=vec4(col,1.);
}`;

let gl,prog,vtex,ltex,detex,snapTex;
const U={};

function markUniformsDirty(){ /* no-op */ }

function updateCanvasDimensions() {
  if (!glCv || !glCv.parentElement) return;
  const p = glCv.parentElement;
  // Élőképen fél DPR-rel futunk ha FX vagy grain aktív: ~4x kevesebb pixel a shadernek.
  // A mentés (capture) NEM ezen a méreten történik: ott a canvas ideiglenesen
  // a kimeneti felbontásra vált egyetlen képkockára.
  const dpr = window.devicePixelRatio || 1;
  const heavyEffect = (window.FX && window.FX.active) || (S.grain > 0);
  const fxScale = heavyEffect ? 0.5 : 1.0;
  cachedCanvasW = Math.round(p.clientWidth * dpr * fxScale);
  cachedCanvasH = Math.round(p.clientHeight * dpr * fxScale);
  
  if(glCv.width !== cachedCanvasW || glCv.height !== cachedCanvasH){
    glCv.width = cachedCanvasW;
    glCv.height = cachedCanvasH;
    if (gl) gl.viewport(0, 0, cachedCanvasW, cachedCanvasH);
    markUniformsDirty();
  }
}
window.addEventListener('resize', updateCanvasDimensions);

/* ── Valós látható magasság (--app-h) ──
   Egyes Samsung böngészők a 100dvh-t hibásan számolják, amikor az alsó
   rendszersáv (vissza/főmenü/appváltó) állandóan látszik – a layout túllóg,
   és az expo gomb levágódik. A visualViewport API a TÉNYLEGESEN látható
   magasságot adja, ezt írjuk CSS-változóba; a .shell ebből kapja a magasságát. */
function syncViewportHeight(){
  // A visualViewport iOS-en sokszor hibás értéket ad PWA módban (levágja a lenti sávot).
  // Az innerHeight PWA-ban mindig a pontos, teljes képernyőmagasság.
  const h = window.innerHeight;
  if (h > 0) document.documentElement.style.setProperty('--app-h', h + 'px');
}
syncViewportHeight();
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);
window.addEventListener('orientationchange', () => setTimeout(syncViewportHeight, 250));

function initGL(){
  if (!glCv) return false;
  // JAVÍTVA: preserveDrawingBuffer értékét visszaállítottuk true-ra, különben a readPixels üres buffert olvas ki exponáláskor
  gl=glCv.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  if(!gl)return false;
  const vs=mkS(gl.VERTEX_SHADER,VS),fs=mkS(gl.FRAGMENT_SHADER,FS);
  if(!vs||!fs)return false;
  prog=gl.createProgram();
  gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){
    console.error('Shader fordítási hiba:', gl.getShaderInfoLog(s));
    return null;
  }
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const al=gl.getAttribLocation(prog,'a_pos');
  gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  gl.uniform1i(gl.getUniformLocation(prog,'u_vid_tex'),0);
  gl.uniform1i(gl.getUniformLocation(prog,'u_lut_tex'),1);
  gl.uniform1i(gl.getUniformLocation(prog,'u_de_tex'),2);
  
  ['u_lut_sz','u_ev','u_vig','u_zoom','u_cvs_sz','u_vid_sz','u_shadows','u_highlights','u_tone', 'u_de_active',
   'uGrainIntensity','uGrainSize','uTime','uIsBW',
   'u_fx_active', 'u_fx_intensity', 'u_fx_scale', 'u_fx_stretch', 'u_fx_angle', 'u_fx_overexposure', 'u_fx_hue', 'u_fx_position', 'u_fx_seed', 'u_fx_bw', 'u_fx_quality'
  ].forEach(n=>U[n]=gl.getUniformLocation(prog,n));
  vtex=mkT();ltex=mkT();detex=mkT();snapTex=mkT();
  
  // JAVÍTVA: A detex textúrának adunk egy alap 1x1 pixeles üres adatot, különben amíg nincs aktív dupla expozíció, az "invalid sampler" teljesen feketére rontja a shadert.
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, detex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  updateCanvasDimensions();
  return true;
}
function mkS(type,src){
  const s=gl.createShader(type);
  gl.shaderSource(s,src);
  gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    console.error('Shader fordítási hiba:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
function mkT(){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  return t;
}

function uploadLUT(ld){
  const{d,sz}=ld,W=sz*sz,rgba=new Uint8Array(W*sz*4);
  for(let bi=0;bi<sz;bi++)for(let gi=0;gi<sz;gi++)for(let ri=0;ri<sz;ri++){
    const li=(bi*sz*sz+gi*sz+ri)*3,ti=(gi*W+bi*sz+ri)*4;
    rgba[ti]=d[li]*255+.5|0;rgba[ti+1]=d[li+1]*255+.5|0;rgba[ti+2]=d[li+2]*255+.5|0;rgba[ti+3]=255;
  }
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,ltex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,W,sz,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  gl.uniform1f(U.u_lut_sz,sz);
}

function render(){
  S.raf=requestAnimationFrame(render);
  // Csak a felbontásváltás kritikus szakaszában nem rajzolunk (S.frozen) –
  // a preserveDrawingBuffer miatt az utolsó kocka marad, így nem "ugrál" a kép.
  // A mentés többi része (2D kompozit, toBlob) alatt az élőkép már fut tovább.
  if(S.frozen)return;
  drawFrame();
}

function drawFrame(){
  if(!S.ready||!vid || vid.readyState<2)return;

  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);

  try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){return;}

  gl.uniform2f(U.u_cvs_sz,cachedCanvasW,cachedCanvasH);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
  gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
  gl.uniform1f(U.u_vig,S.vignette);
  gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);

  // Grain: slider 0..1 → uGrainIntensity 0..0.2, uGrainSize 1.0..3.5
  gl.uniform1f(U.uGrainIntensity, S.grain * 0.2);
  gl.uniform1f(U.uGrainSize, 1.0 + S.grain * 2.5);
  gl.uniform1f(U.uTime, performance.now() / 1000.0);
  gl.uniform1f(U.uIsBW, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);

  if (S.deActive && S.deStage === 1) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detex);
    gl.uniform1f(U.u_de_active, 1.0);
  } else {
    gl.uniform1f(U.u_de_active, 0.0);
  }

  gl.uniform1f(U.u_fx_active, window.FX.active ? 1.0 : 0.0);
  gl.uniform1f(U.u_fx_intensity, window.FX.intensity);
  gl.uniform1f(U.u_fx_scale, window.FX.scale);
  gl.uniform1f(U.u_fx_stretch, window.FX.stretch);
  gl.uniform1f(U.u_fx_angle, window.FX.angle);
  gl.uniform1f(U.u_fx_overexposure, window.FX.overexposure);
  gl.uniform1f(U.u_fx_hue, window.FX.hue);
  gl.uniform2f(U.u_fx_position, window.FX.position[0], window.FX.position[1]);
  gl.uniform1f(U.u_fx_seed, window.FX.seed);
  gl.uniform1f(U.u_fx_bw, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);
  gl.uniform1f(U.u_fx_quality, 0.0);

  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ── Dial ── */
const MODES={
  exposure:   {min:-2,  max:2,   step:.05,hasCenter:true, fmt:v=>(v>0?'+':'')+v.toFixed(2)+' EV'},
  shadows:    {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  highlights: {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  tone:       {min:-1,  max:1,   step:.04,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  grain:      {min:0,   max:1,   step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
  vignette:   {min:-1,  max:1,   step:.04,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
};
const TPX=14; 
let ddrag=false,dlast=0,doff=0;

function nT(){const m=MODES[S.mode];return Math.round((m.max-m.min)/m.step);}
function getV(){return{exposure:S.exposure,shadows:S.shadows,highlights:S.highlights,tone:S.tone,grain:S.grain,vignette:S.vignette}[S.mode];}
function setV(v){
  const m=MODES[S.mode];v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  const prevGrain=S.grain;
  if(S.mode==='exposure')S.exposure=v;else if(S.mode==='shadows')S.shadows=v;else if(S.mode==='highlights')S.highlights=v;else if(S.mode==='tone')S.tone=v;else if(S.mode==='grain')S.grain=v;else S.vignette=v;
  // Ha a grain 0-ról indult el vagy 0-ra tért vissza, frissítjük a canvas felbontást
  if(S.mode==='grain' && ((prevGrain===0)!==(S.grain===0))) updateCanvasDimensions();
  markUniformsDirty();
  return v;
}
function o2v(o){const m=MODES[S.mode],N=nT();return m.min+(-o/N/TPX)*(m.max-m.min);}
function v2o(v){const m=MODES[S.mode],N=nT();return-((v-m.min)/(m.max-m.min))*N*TPX;}

function buildDial(){
  const el=document.getElementById('dial-ticks');if(!el)return;
  el.innerHTML='';
  const m=MODES[S.mode],N=nT();
  const cIdx=m.hasCenter?Math.round((0-m.min)/m.step):-1;
  for(let i=0;i<=N;i++){
    const t=document.createElement('div'),maj=i%5===0,isC=(i===cIdx);
    t.className='dt'+(maj?' maj':'')+(isC?' zero':'');
    t.style.height=(maj?28:15)+'px';
    el.appendChild(t);
  }
  const cm=document.querySelector('.dial-center-h');
  if(cm)cm.style.opacity=m.hasCenter?'1':'0';
  const dialWrap=document.getElementById('dial-wrap');
  const centerLine=document.querySelector('.dial-center-h');
  if(dialWrap&&centerLine)centerLine.style.left=dialWrap.clientWidth/2+'px';
}

function syncDial(){const v=getV(),o=v2o(v);doff=o;const el=document.getElementById('dial-ticks');if(el)el.style.transform=`translateX(${o - 7}px)`;updHUD(v);}
function updHUD(v){const m=MODES[S.mode],f=m.fmt(v);document.getElementById('hud-mode-val').textContent=f;document.getElementById('hud-mode-name').textContent=S.mode.toUpperCase();}
function dMove(dx){doff+=dx;const v=setV(o2v(doff));doff=v2o(v);const el=document.getElementById('dial-ticks');if(el)el.style.transform=`translateX(${doff - 7}px)`;updHUD(v);}

const dialEl=document.getElementById('dial-wrap');
if (dialEl) {
  dialEl.addEventListener('pointerdown',e=>{ddrag=true;dlast=e.clientX;dialEl.setPointerCapture(e.pointerId);},{passive:true});
  dialEl.addEventListener('pointermove',e=>{if(!ddrag)return;dMove(e.clientX-dlast);dlast=e.clientX;},{passive:true});
  dialEl.addEventListener('pointerup',()=>ddrag=false);
  dialEl.addEventListener('pointercancel',()=>ddrag=false);
}

/* ── Tap-to-focus & Pinch-to-zoom ── */
const vfOverlay = document.getElementById('focus-overlay');
let vfPointers = new Map();
let vfInitDist = 0;
let vfInitZoom = 1.0;
let isPinching = false;

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
        nz = Math.max(1.0, Math.min(4.0, nz));
        S.zoom = Math.round(nz / 0.05) * 0.05;
        markUniformsDirty();
        syncDial();
      }
    }
  });

  function handleVfPointerUp(e) {
    try { vfOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
    // A koppintásos fókusz hívását töröltük innen
    vfPointers.delete(e.pointerId);
    if (vfPointers.size === 0) {
      isPinching = false;
    }
  }

  vfOverlay.addEventListener('pointerup', handleVfPointerUp);
  vfOverlay.addEventListener('pointercancel', handleVfPointerUp);
}

/* ── AE/AF zár (natív kamera-viselkedés) ──
   Koppintás: a fókusz ÉS a fénymérés arra a pontra zár, és OTT MARAD, amíg
   máshová nem koppintasz. Dupla koppintás: vissza teljes automatikára. */

// Szoftveres fénymérés a koppintott pontra: a terület átlagos fényességét
// kimérjük a videókockából, és akkora digitális EV-korrekciót számolunk,
// ami középtónusra húzza. Ez MINDEN eszközön működik (a mentett képre is hat) –
// ott is, ahol a kamera hardveresen nem tud pont-alapú fénymérést.
let aeSampleCv = null;



function updateFocusLabel(txt){
  const fl = document.getElementById('hud-focus-label');
  if (fl) fl.textContent = 'AF';
}


let lastVfTap = { t: 0, x: 0, y: 0 };



function tryLoadLuts(){ return Promise.resolve(); }

function buildFilmList(){
  const list=document.getElementById('film-list'); if(!list) return;
  list.innerHTML='';
  for(const[k,p]of Object.entries(PROF)){
    const it=document.createElement('div');it.className='film-item'+(S.simKey===k?' active':'');
    it.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${p.name}</div><div class="film-sub">${p.sub}</div></div>`;
    it.onclick=()=>{
      S.simKey=k;uploadLUT(p.lut);
      markUniformsDirty();
      const lbl = document.getElementById('film-label');
      if (lbl) lbl.textContent=p.name;
      closeModal();
    };
    list.appendChild(it);
  }
}
function openModal(){buildFilmList(); const m = document.getElementById('film-modal'); if(m) m.classList.remove('hidden');}
function closeModal(){const m = document.getElementById('film-modal'); if(m) m.classList.add('hidden');}

const filmBtn = document.getElementById('film-btn'); if (filmBtn) filmBtn.addEventListener('click',openModal);
const modalClose = document.getElementById('modal-close'); if (modalClose) modalClose.addEventListener('click',closeModal);
const modalBackdrop = document.getElementById('modal-backdrop'); if (modalBackdrop) modalBackdrop.addEventListener('click',closeModal);

function toggleDoubleExposure() {
  S.deActive = !S.deActive;
  S.deStage = 0;
  markUniformsDirty();
  const btn = document.getElementById('de-toggle-btn');
  const sht = document.getElementById('shutter');
  if (btn) btn.classList.toggle('active', S.deActive);
  if (sht) sht.classList.remove('de-primed');
  const fl = document.getElementById('hud-focus-label');
  if (fl) fl.textContent = 'AF';
}

function getSelectedFrame() {
  const activeRadio = document.querySelector('input[name="frame-opt"]:checked');
  return activeRadio ? activeRadio.value : 'none';
}

function updateLiveFramePreview() {
  const frame = getSelectedFrame();
  const filmFrame = document.getElementById('preview-frame-film');
  const antikFrame = document.getElementById('preview-frame-antik');
  
  if (filmFrame) filmFrame.classList.add('hidden');
  if (antikFrame) antikFrame.classList.add('hidden');
  
  if (frame === 'film' && filmFrame) {
    filmFrame.classList.remove('hidden');
  } else if (frame === 'antik' && antikFrame) {
    antikFrame.classList.remove('hidden');
  }
}

function getRetroDateString() {
  const now = new Date(), p = n => String(n).padStart(2, '0');
  const dd = p(now.getDate());
  const mm = p(now.getMonth() + 1);
  const yy = String(now.getFullYear()).slice(-2);
  return `Anno ${dd} ${mm} '${yy}`;
}

function updateLiveDate() {
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

function toggleFlash() {
  flashEnabled = !flashEnabled;
  const btn = document.getElementById('torch-toggle-btn');
  if (btn) btn.classList.toggle('active', flashEnabled);
  if (flashEnabled) {
    const tk = S.stream && S.stream.getVideoTracks()[0];
    let caps = {};
    try { caps = tk && tk.getCapabilities ? tk.getCapabilities() : {}; } catch(_) {}
    dlog('Vaku BE. torch képesség: ' + JSON.stringify(caps.torch));
    if (!(tk && trackSupportsTorch(tk))) showToast('Ezen a kamerán nincs vaku');
  } else { dlog('Vaku KI.'); }
}

function toggleDust() {
  if (window.FX) {
    window.FX.active = !window.FX.active;
    const btn = document.getElementById('dust-toggle-btn');
    if (btn) btn.classList.toggle('active', window.FX.active);
    
    if (window.FX.active) {
      window.FX.randomize();
    }
    // FX be/ki: canvas felbontás frissítése (aktív=fél DPR, inaktív=teljes DPR)
    updateCanvasDimensions();
    markUniformsDirty();
  }
}

// Mentés-jelző: expo közben teljes képernyős overlay (spinner + MENTÉS felirat),
// ami minden érintést elnyel, így mentés alatt nem lehet az appba belenyúlni.
function setSavingIndicator(on){
  const el = document.getElementById('saving-overlay');
  if (el) el.classList.toggle('hidden', !on);
}

function triggerMechanicalShutter(callback) {
  const blink = document.getElementById('shutter-blink');
  if(!blink) { callback(); return; }
  blink.classList.remove('hidden', 'open');
  blink.getBoundingClientRect(); 
  blink.classList.add('active'); 
  setTimeout(async () => {
    // A redőny addig marad csukva, amíg az expo ténylegesen el nem készült –
    // így vizuálisan is jelzi, hogy "még tart a felvétel", nem fix időzítőn nyit.
    try { await callback(); } catch(_) {}
    blink.classList.add('open');
    blink.classList.remove('active');
    setTimeout(() => {
      blink.classList.add('hidden');
      blink.classList.remove('open');
    }, 160);
  }, 120);
}

function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}

function waitForVideoFrames(n, minMs) {
  const startTime = performance.now();
  const hasRVFC = vid && typeof vid.requestVideoFrameCallback === 'function';
  return new Promise(resolve => {
    let framesSeen = 0;
    let settled = false;
    const done = () => { if (settled) return; settled = true; clearTimeout(minTimer); clearTimeout(hardTimer); resolve(); };

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
          vid.requestVideoFrameCallback(step);
        }
      };
      vid.requestVideoFrameCallback(step);
    }
  });
}

function trackSupportsTorch(track) {
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    return !!caps.torch;
  } catch (_) { return false; }
}

// A futó stream felbontásának átállítása újranyitás nélkül.
// 1) Az "ideal" önmagában csak javaslat, ezért "max"-szal kényszerítjük a leváltást.
// 2) SZÁNDÉKOSAN NEM kényszerítünk képarányt: Samsung eszközökön az aspectRatio
//    constraint a szenzorkép megvágásával (digitális zoommal!) teljesülhet, így
//    a mentett kép "belenagyítottnak" tűnt az előnézethez képest. A cropUV
//    cover-logikája bármilyen képarányú forrásból helyes középvágást ad,
//    a látómező-ugrást pedig a befagyasztott előnézet (S.frozen) takarja.
// 3) A beragadás-ellenőrzés KÉSLELTETVE fut, mert az applyConstraints után a
//    getSettings() egy ideig még a régi értéket mutathatja.
let resReqId = 0;
async function setStreamResolution(px, waitFrames = true) {
  if (!S.stream) return false;
  const tk = S.stream.getVideoTracks()[0];
  if (!tk) return false;
  const myReq = ++resReqId;

  let ok = true;
  try {
    await tk.applyConstraints({ width: { ideal: px, max: px }, height: { ideal: px, max: px } });
    if (waitFrames) await waitForVideoFrames(3, 250);
  } catch (_) { ok = false; }

  const sync = () => {
    let st = {};
    try { st = tk.getSettings(); } catch (_) {}
    // A videoWidth/Height a TÉNYLEGESEN dekódolt képkocka mérete – Samsungon a
    // getSettings() néha a kért (nem a valós) értéket jelenti, ezért az élvez elsőbbséget.
    S.vidW = vid.videoWidth || st.width || S.vidW;
    S.vidH = vid.videoHeight || st.height || S.vidH;
    const resEl = document.getElementById('hud-res');
    if (resEl) resEl.textContent = S.vidW + '×' + S.vidH;
    markUniformsDirty();
    return st;
  };
  sync();
  // Felbontásváltáskor egyes eszközök újraindítják az AE/AF-et – a zárat
  // visszakényszerítjük. Betonozott (manual) fókusznál a tárolt távolságot
  // állítjuk vissza, így nincs újabb fókusz-söprés.
  

  if (!waitFrames) {
    // Késleltetett utó-ellenőrzés: csak ha azóta nem jött újabb kérés,
    // nem mentünk éppen, és a track tényleg beragadt nagy felbontáson.
    setTimeout(() => {
      if (myReq !== resReqId || !S.stream || S.saving) return;
      // Csak ha még mindig EZ az aktív track – kameraváltás közben nem nyúlunk bele
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

async function capture(){
  if(S.saving||!S.ready)return;
  if(!(vid && vid.readyState>=2))return;
  S.saving = true;
  setSavingIndicator(true);
  dlog('EXPO indul. flashEnabled=' + flashEnabled);

  // Vaku-módban BEVÁRJUK az élesítést (a torch-parancs csak utána garantáltan
  // érvényes), majd néhány kockát, hogy a fény beérjen az expozícióba
  if (flashEnabled) { try { await armPromise; } catch (_) {} }
  dlog('EXPO: torchArmed=' + torchArmed);
  if (torchArmed) await waitForVideoFrames(5, 400);

  if(S.deActive && S.deStage === 0) {
    // DE 1. réteg: PILLANATKÉP azonnal, a felengedés pillanatában
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid); } catch(e){}
    torchOff();
    armPromise = null;
    setStreamResolution(PREVIEW_RES, false);
    triggerMechanicalShutter(() => {
      S.deStage = 1;
      const fl = document.getElementById('hud-focus-label');
      if (fl) fl.textContent = 'DE 2/2';
      const sh = document.getElementById('shutter');
      if (sh) sh.classList.add('de-primed');
      setSavingIndicator(false);
      S.saving = false;
    });
    return; 
  }

  // PILLANATKÉP-ELV: a felengedés pillanatában az aktuális videókockát azonnal
  // textúrába égetjük. Minden lassú lépés (render, keret, JPEG) már EBBŐL dolgozik,
  // nem az élő videóból – hiába mozdul utána a telefon, a mentett kép ez a
  // pillanat marad. A felbontás az, amin a stream épp áll: nyomva tartásnál az
  // elő-élesített 1600, villámgyors koppintásnál a 720-as preview-kocka.
  const snapW = vid.videoWidth || S.vidW;
  const snapH = vid.videoHeight || S.vidH;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, snapTex);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid); } catch(e){}
  torchOff();

  triggerMechanicalShutter(async () => {
    armPromise = null;

    // FRAME-YIELD: két képkockányi lehetőséget adunk a böngészőnek, hogy a
    // MENTÉS jelzőt kirajzolja, MIELŐTT a szinkron nehéz rész (GL render,
    // readPixels, kompozit) blokkolná a szálat – enélkül a spinner sosem
    // jelent meg, mert a kirajzolásig el sem jutott a böngésző.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    if (window.FX && window.FX.active) { window.FX.seed = Math.random(); }
    
    // Mentési felbontás és vágás a pillanatkép méreteiből
    const frameW = snapW;
    const frameH = snapH;
    const srcShort = Math.min(frameW, frameH) || PREVIEW_RES;
    const OUT = Math.max(PREVIEW_RES, Math.min(SAVE_RES, srcShort));
    const frame = getSelectedFrame();
    let cw=OUT,ch=OUT,photoX=0,photoY=0,photoS=OUT;

    if(frame==='antik'){
      photoS=OUT; photoX=0; photoY=0; cw=OUT; ch=OUT;
    } else if(frame==='polaroid'){
      const pad=Math.round(OUT*.06),bot=Math.round(OUT*.22);
      cw=OUT+pad*2;ch=OUT+pad+bot;photoX=pad;photoY=pad;photoS=OUT;
    } else if(frame==='film'){
      photoS=OUT; photoX=0; photoY=0; cw=OUT; ch=OUT;
    }

    const sv=document.getElementById('save-canvas');
    if(!sv){ S.saving=false; setSavingIndicator(false); return; }
    sv.width=cw;sv.height=ch;
    const sCtx=sv.getContext('2d');

    if(frame==='polaroid'){sCtx.fillStyle='#f2ede4';} else {sCtx.fillStyle='#000';}
    sCtx.fillRect(0,0,cw,ch);

    if(S.ready&&vid&&vid.readyState>=2){
      // A canvast EGY képkockára a kimeneti felbontásra állítjuk. Az élőképet nem érinti
      // (a shutter-animáció eltakarja), utána updateCanvasDimensions() visszaállítja.
      glCv.width = OUT; glCv.height = OUT;
      gl.viewport(0, 0, OUT, OUT);

      // A felengedéskor elmentett PILLANATKÉP-textúrából renderelünk,
      // nem az élő videóból – a telefon közben nyugodtan mozoghat
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,snapTex);
      // u_cvs_sz = OUT×OUT → pontos négyzetes vágás; u_vid_sz = TÉNYLEGES frame-méret
      gl.uniform2f(U.u_cvs_sz,OUT,OUT);gl.uniform2f(U.u_vid_sz,frameW,frameH);
      gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
      gl.uniform1f(U.u_vig,S.vignette);
      gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);
      
      // Grain capture-kor: a szemcse PIXELBEN számolódik, ezért nagyobb felbontáson
      // ugyanaz a beállítás sokkal finomabb (alig látható) szemcsét adna, mint az
      // előnézeten. A méretet az előnézeti canvashoz skálázzuk, így a mentett kép
      // grainje UGYANÚGY néz ki, mint amit a felhasználó a keresőben látott.
      const grainScale = OUT / Math.max(1, Math.min(cachedCanvasW, cachedCanvasH));
      gl.uniform1f(U.uGrainIntensity, S.grain * 0.2);
      gl.uniform1f(U.uGrainSize, (1.0 + S.grain * 2.5) * grainScale);
      gl.uniform1f(U.uTime, performance.now() / 1000.0);
      gl.uniform1f(U.uIsBW, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);
      
      if(S.deActive && S.deStage === 1) {
        gl.uniform1f(U.u_de_active, 1.0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, detex);
      } else {
        gl.uniform1f(U.u_de_active, 0.0);
      }
      
      gl.uniform1f(U.u_fx_active, window.FX.active ? 1.0 : 0.0);
      gl.uniform1f(U.u_fx_intensity, window.FX.intensity);
      gl.uniform1f(U.u_fx_scale, window.FX.scale);
      gl.uniform1f(U.u_fx_stretch, window.FX.stretch);
      gl.uniform1f(U.u_fx_angle, window.FX.angle);
      gl.uniform1f(U.u_fx_overexposure, window.FX.overexposure);
      gl.uniform1f(U.u_fx_hue, window.FX.hue);
      gl.uniform2f(U.u_fx_position, window.FX.position[0], window.FX.position[1]);
      gl.uniform1f(U.u_fx_seed, window.FX.seed);
      gl.uniform1f(U.u_fx_bw, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);
      gl.uniform1f(U.u_fx_quality, 1.0);

      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

      markUniformsDirty();
    }
    
    if (!memoTmpCanvas) { memoTmpCanvas = document.createElement('canvas'); }
    if (!memoSrcCanvas) { memoSrcCanvas = document.createElement('canvas'); }
    
    memoTmpCanvas.width = photoS; memoTmpCanvas.height = photoS;
    memoSrcCanvas.width = OUT; memoSrcCanvas.height = OUT;
    
    const tc = memoTmpCanvas.getContext('2d');
    const srcCtx = memoSrcCanvas.getContext('2d');
    
    // Teljes felbontású kiolvasás a most renderelt OUT×OUT bufferből
    const pixels=new Uint8Array(OUT*OUT*4);
    gl.readPixels(0,0,OUT,OUT,gl.RGBA,gl.UNSIGNED_BYTE,pixels);

    // Élőkép canvas visszaállítása az eredeti (alacsony) felbontásra
    updateCanvasDimensions();
    // Stream vissza alacsony felbontásra, ha az elő-élesítés felvitte –
    // az élőkép közben végig futott, nincs fagyás
    setStreamResolution(PREVIEW_RES, false);

    // Újabb lélegzetvétel a böngészőnek a 2D kompozit előtt
    await new Promise(r => requestAnimationFrame(r));

    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), OUT, OUT), 0, 0);

    tc.save();
    tc.translate(0, photoS);
    tc.scale(1, -1);
    tc.drawImage(memoSrcCanvas, 0, 0, OUT, OUT, 0, 0, photoS, photoS);
    tc.restore();

    sCtx.drawImage(memoTmpCanvas,photoX,photoY,photoS,photoS);

    if(frame==='antik'){
      try{
        const fimg=await loadImg('antik_keret_web.png');
        sCtx.drawImage(fimg,0,0,OUT,OUT);
      }catch(e){}
    } else if(frame==='film'){
      drawFilm(sCtx,cw,ch,Math.round(OUT*.13));
    }

    const dateTog = document.getElementById('date-tog');
    if(dateTog && dateTog.checked && frame !== 'antik'){
      const now=new Date(),p=n=>String(n).padStart(2,'0');
      const fs=Math.max(14,photoS*.036|0);
      const ds=`${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
      sCtx.font=`bold ${fs}px Courier New`;sCtx.textAlign='right';
      let tx = photoX + photoS - fs * 0.5;
      let ty = photoY + photoS - fs * 0.4;
      if (frame === 'film') {
        ty = photoY + photoS - Math.round(OUT * 0.13) - fs * 0.4;
      }
      sCtx.fillStyle='rgba(0,0,0,0.6)';
      sCtx.fillText(ds,tx+2,ty+2);
      sCtx.fillStyle='#e8830a';
      sCtx.fillText(ds,tx,ty);
    }

    if(frame==='polaroid'){
      const fs=Math.round(OUT*.026);
      sCtx.font=`${fs}px Courier New`;sCtx.textAlign='right';sCtx.fillStyle='#5a5040';
      sCtx.fillText('by Analogia',photoX+photoS-Math.round(OUT*.02),ch-Math.round((ch-photoY-photoS)/2+fs*.3));
    }

    sv.toBlob(blob=>{
      const now=new Date(),p=n=>String(n).padStart(2,'0');
      const nm=(PROF[S.simKey]?.name||'CUSTOM').replace(/[ &]/g,'_');
      const fname=`Analogia_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.jpg`;
      
      if(S.lastPhotoUrl) URL.revokeObjectURL(S.lastPhotoUrl);
      const url=URL.createObjectURL(blob);
      S.lastPhotoUrl = url;
      activeBlobUrl = url;
      activeFilename = fname;
      
      const previewImg = document.getElementById('photo-preview-img');
      const photoOverlay = document.getElementById('photo-overlay');
      setSavingIndicator(false);
      if (previewImg && photoOverlay) {
        previewImg.src = url;
        previewImg.alt = fname;
        previewImg.setAttribute('data-filename', fname);
        photoOverlay.classList.remove('hidden');
      }
      
      if(S.deActive) {
        S.deStage = 0;
        const sh = document.getElementById('shutter'); if(sh) sh.classList.remove('de-primed');
        updateFocusLabel();
      }
      S.saving=false;
      // Mentés után visszaváltás: ha FX aktív, fél DPR-re vissza
      updateCanvasDimensions();
    },'image/jpeg',.92);
  });
}

function drawFilm(c,W,H,sh){
  [0,H-sh].forEach(sy=>{
    c.fillStyle='#1e1c17';
    c.fillRect(0,sy,W,sh);
    const hh=Math.round(sh * 0.55), hy=sy+(sh-hh)/2;
    const steps = 5;
    const colWidth = W / steps;
    const hw = Math.round(colWidth * 0.35); 
    c.fillStyle='#0a0904';
    for(let i=0; i<steps; i++) {
      const x = Math.round((colWidth * i) + (colWidth - hw) / 2);
      c.beginPath();
      c.rect(x,hy,hw,hh);
      c.fill();
    }
  });
}

async function listVideoDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter(d => d.kind === 'videoinput');
  } catch(_) { videoDevices = []; }
}

async function cycleCamera() {
  if (videoDevices.length <= 1) await listVideoDevices();
  if (videoDevices.length <= 1) return;
  currentDeviceIndex = (currentDeviceIndex + 1) % videoDevices.length;
  const nextDevice = videoDevices[currentDeviceIndex];
  if (nextDevice) await initCam(nextDevice.deviceId);
}

async function initCam(preferredDeviceId = null){
  // FONTOS: a korábbi render-loop leállítása. Enélkül minden kameraváltás /
  // stream-újranyitás után EGGYEL TÖBB render-ciklus futna párhuzamosan,
  // ami fokozatosan belassítja az élőképet.
  if (S.raf) { cancelAnimationFrame(S.raf); S.raf = null; }
  if(S.stream) S.stream.getTracks().forEach(track => track.stop());
  markUniformsDirty();
  try{
    // Élőképhez alacsony felbontás (nincs késés) – exponáláskor a
    // setStreamResolution(CAPTURE_RES) ideiglenesen felváltja.
    const constraints = { audio:false, video:{ width:{ideal:PREVIEW_RES}, height:{ideal:PREVIEW_RES} } };
    if (preferredDeviceId) constraints.video.deviceId = { exact: preferredDeviceId };
    else constraints.video.facingMode = { ideal: 'environment' };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    S.stream=stream; if (vid) vid.srcObject=stream;
    if (vid) {
      // Ha az előző initCam loadedmetadata listenere még nem sült el (gyors
      // kameraváltás), itt eltávolítjuk – különben a régi closure elavult
      // track-adatokkal írná felül a S.vidW/H-t és plusz render-loopot indítana.
      if (onVidMeta) { vid.removeEventListener('loadedmetadata', onVidMeta); onVidMeta = null; }
      onVidMeta = ()=>{
        onVidMeta = null;
        S.ready=true;
        const tk=stream.getVideoTracks()[0],st=tk.getSettings();
        if(videoDevices.length === 0) {
          listVideoDevices().then(() => {
            currentDeviceIndex = videoDevices.findIndex(d => d.deviceId === st.deviceId);
            if(currentDeviceIndex === -1) currentDeviceIndex = 0;
          });
        } else {
          currentDeviceIndex = videoDevices.findIndex(d => d.deviceId === st.deviceId);
          if(currentDeviceIndex === -1) currentDeviceIndex = 0;
        }
        S.vidW=st.width||vid.videoWidth;S.vidH=st.height||vid.videoHeight;
        vid.play().catch(()=>{});
        const resEl = document.getElementById('hud-res'); if(resEl) resEl.textContent=S.vidW+'×'+S.vidH;
        const npEl = document.getElementById('noperm'); if(npEl) npEl.style.display='none';
        // Új stream/kamera: a korábbi AE/AF zár pontja itt már értelmetlen
        S.focusLock = null;
        const fring = document.getElementById('focus-ring');
        if (fring) fring.classList.add('hidden');
        updateFocusLabel();
        tk.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
        updateCanvasDimensions();
        render();
      };
      vid.addEventListener('loadedmetadata', onVidMeta, {once:true});
    }
  }catch(e){
    const peEl = document.getElementById('perm-err');
    if (peEl) peEl.textContent=e.name==='NotAllowedError'?'Engedély megtagadva.':e.name==='NotFoundError'?'Nincs kamera.':'Kamera hiba.';
  }
}

const permBtn = document.getElementById('perm-btn'); if(permBtn) permBtn.addEventListener('click',() => initCam());

/* ── Elő-élesítés ──
   A felbontásváltást már a gomb LENYOMÁSAKOR elindítjuk, és a FELENGEDÉSKOR
   exponálunk. Az ujj természetes lenyomva-tartása (~100-300ms) elfedi a váltás
   idejét, így a mentett kép a felengedés pillanatát rögzíti, nem fél mp-cel későbbit. */
let armPromise = null;
let torchArmed = false;
const shutterBtn = document.getElementById('shutter');

function torchOff(){
  if (!torchArmed) return;
  torchArmed = false;
  const tk = S.stream && S.stream.getVideoTracks()[0];
  if (tk) tk.applyConstraints({ advanced: [{ torch: false }] }).catch(()=>{});
}

function armCapture(e) {
  if (S.saving || !S.ready) return;
  try { if (e && shutterBtn) shutterBtn.setPointerCapture(e.pointerId); } catch (_) {}
  
  armPromise = (async () => {
    // Sima felbontásváltás a mentéshez
    await setStreamResolution(CAPTURE_RES);

    if (flashEnabled && S.stream) {
      const tk = S.stream.getVideoTracks()[0];
      if (tk && trackSupportsTorch(tk)) {
        torchArmed = false;
        try {
          await tk.applyConstraints({ advanced: [{ torch: true }] });
          let st = {}; try { st = tk.getSettings(); } catch(_) {}
          if (st.torch === true) {
            torchArmed = true;
          } else {
            await tk.applyConstraints({ torch: true });
            try { st = tk.getSettings(); } catch(_) {}
            torchArmed = (st.torch === true);
          }
        } catch (e) {
          dlog('VAKU elutasítva: ' + (e && e.name) + ' ' + (e && e.message));
        }
        if (!torchArmed) showToast('A kamera elutasította a vakut');
      }
    }
  })();
}


function disarmCapture() {
  armPromise = null;
  torchOff();
  if (!S.saving) setStreamResolution(PREVIEW_RES, false);
}
if(shutterBtn) {
  shutterBtn.addEventListener('pointerdown', armCapture, {passive:true});
  shutterBtn.addEventListener('pointerup', capture);
  shutterBtn.addEventListener('pointercancel', disarmCapture);
}

// Rejtett diag-kapcsoló: 7 gyors koppintás az ANALOGIA feliratra
// (telepített PWA-ban így érhető el a napló, URL-paraméter nélkül)
const brandEl = document.querySelector('.brand');
let diagTaps = 0, diagTapTimer = null;
if (brandEl) brandEl.addEventListener('click', () => {
  diagTaps++;
  clearTimeout(diagTapTimer);
  diagTapTimer = setTimeout(() => { diagTaps = 0; }, 1600);
  if (diagTaps >= 7) { diagTaps = 0; toggleDiag(); }
});

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');S.mode=btn.dataset.mode;buildDial();syncDial();
  });
});

const deTogBtn = document.getElementById('de-toggle-btn'); if(deTogBtn) deTogBtn.addEventListener('click', toggleDoubleExposure);
const camTogBtn = document.getElementById('cam-toggle-btn'); if(camTogBtn) camTogBtn.addEventListener('click', cycleCamera);
const torchTogBtn = document.getElementById('torch-toggle-btn'); if(torchTogBtn) torchTogBtn.addEventListener('click', toggleFlash);
const dustTogBtn = document.getElementById('dust-toggle-btn'); if(dustTogBtn) dustTogBtn.addEventListener('click', toggleDust);

const fxRndBtn = document.getElementById('fx-rnd-btn');
if (fxRndBtn) {
  fxRndBtn.addEventListener('click', () => {
    if (!window.FX) return;
    if (window.FX.active) {
      window.FX.randomize();
      markUniformsDirty();
    } else {
      toggleDust();
    }
  });
}

function syncDateToggleAvailability() {
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

document.querySelectorAll('input[name="frame-opt"]').forEach(radio => {
  radio.addEventListener('change', () => {
    syncDateToggleAvailability();
    updateLiveFramePreview();
    updateLiveDate();
  });
});

const dateTogEl = document.getElementById('date-tog');
if (dateTogEl) {
  dateTogEl.addEventListener('change', updateLiveDate);
}

const photoCloseBtn = document.getElementById('photo-overlay-close');
if (photoCloseBtn) {
  photoCloseBtn.onclick = () => {
    const photoOverlay = document.getElementById('photo-overlay');
    if (photoOverlay) photoOverlay.classList.add('hidden');
  };
}

const natInstBtn = document.getElementById('native-install-btn');
if (natInstBtn) {
  natInstBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        deferredPrompt = null;
        const desc = document.querySelector('.install-desc');
        const actions = document.querySelector('.install-actions');
        if (desc) {
          desc.innerHTML = "<span style='color: #c8a84b; font-weight: bold; display: block; margin-bottom: 8px;'>✓ SIKERES TELEPÍTÉS!</span>" +
                           "Az Analogia ikonja bekerült a menüdbe / kezdőképernyődre.<br>" +
                           "Ezt a böngészőlapot most már bezárhatod.";
        }
        if (actions) actions.style.display = 'none';
        setTimeout(() => { window.close(); }, 1500);
      }
    } else {
      const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isiOS) alert("iOS-en: Kattints a Safari alsó Megosztás gombjára, majd a 'Hozzáadás a kezdőképernyőhöz' opcióra!");
      else alert("Kérjük, használd a böngésző menüjének 'Telepítés' vagy 'Hozzáadás a főképernyőhöz' pontját!");
    }
  });
}

const exitBtn = document.getElementById('exit-btn');
if (exitBtn) {
  exitBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(()=>{});
    } else {
      if(S.stream) {
        S.stream.getTracks().forEach(t=>t.stop());
        S.ready = false;
        const npEl = document.getElementById('noperm'); if(npEl) npEl.style.display = 'flex';
      }
      window.close();
    }
  });
}

document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  const desc = document.querySelector('.install-desc');
  const actions = document.querySelector('.install-actions');
  if (desc) {
    desc.innerHTML = "<span style='color: #c8a84b; font-weight: bold; display: block; margin-bottom: 8px;'>✓ SIKERES TELEPÍTÉS!</span>Ezt a lapot most már bezárhatod, and indíthatod az appot a kezdőképernyőről.";
  }
  if (actions) actions.style.display = 'none';
  setTimeout(() => { window.close(); }, 1500);
});

(async()=>{
  checkStandaloneGuard(); 
  if(!initGL()){ const pe = document.getElementById('perm-err'); if(pe) pe.textContent='WebGL nem elérhető.'; return; }
  if (glCv) {
    glCv.addEventListener('webglcontextlost',e=>{
      e.preventDefault();
      cancelAnimationFrame(S.raf);
      S.raf=null;
      S.ready=false;
    });
    glCv.addEventListener('webglcontextrestored',()=>{
      if(!initGL())return;
      markUniformsDirty();
      const ld=PROF[S.simKey]?.lut;
      if(ld)uploadLUT(ld);
      if(S.stream)render();
    });
  }

  buildDial();
  await loadExternalFilters();
  if (PROF[S.simKey]) {
    uploadLUT(PROF[S.simKey].lut);
    const fl = document.getElementById('film-label'); if(fl) fl.textContent = PROF[S.simKey].name;
  }
  syncDial();
  syncDateToggleAvailability();
  updateLiveFramePreview();
  updateLiveDate();
  await listVideoDevices();
  if(navigator.mediaDevices?.getUserMedia) initCam();
  else { const pe = document.getElementById('perm-err'); if(pe) pe.textContent='Kamera API nem támogatott.'; }
})();