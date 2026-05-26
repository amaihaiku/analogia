'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v16 (Modular WYSIWYG Double Exposure Update)
   Features: Dynamic external folder-based injection arrays,
   iOS hardware shutter sync, mandatory WebGL unit 2 texture
   completeness binder, standalone installation routing.
═══════════════════════════════════════ */

const AVAILABLE_FILTERS = ['kodachrome', 'kodak_portra', 'fuji_velvia', 'cinestill', 'teal_orange', 'bleach', 'cross', 'highcontrast_bw', 'l_monochrome', 'infrared'];

const S={
  stream:null,raf:null,ready:false,saving:false,
  simKey:'kodachrome',cpuLut:null,
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

let activeBlobUrl = null;
let activeFilename = "";

const vid = document.getElementById('vid');
const glCv = document.getElementById('gl-canvas');

function checkStandaloneGuard() {
  const urlParams = new URLSearchParams(window.location.search);
  const isPwaParam = urlParams.get('mode') === 'standalone';
  
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone || 
                       isPwaParam;
  
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

const PROF={};
const XLUTS={};

async function loadExternalFilters() {
  const promises = AVAILABLE_FILTERS.map(id => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = `filters/${id}.js?v=16`;
      script.onload = resolve;
      script.onerror = resolve; 
      document.head.appendChild(script);
    });
  });
  await Promise.all(promises);
  
  for (const id of AVAILABLE_FILTERS) {
    if (window.PD && window.PD[id]) {
      PROF[id] = {
        name: window.PD[id].name,
        sub: window.PD[id].sub,
        lut: bake(window.PD[id].fn)
      };
    }
  }
}

/* ── WebGL WYSIWYG Shader Engine ── */
const VS=`attribute vec2 a_pos;varying vec2 v_uv;
void main(){v_uv=vec2(a_pos.x*.5+.5,.5-a_pos.y*.5);gl_Position=vec4(a_pos,0.,1.);}`;

const FS=`precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_vid_tex;uniform sampler2D u_lut_tex;uniform sampler2D u_de_tex;
uniform float u_lut_sz;uniform vec2 u_cvs_sz;uniform vec2 u_vid_sz;
uniform float u_zoom;uniform float u_ev;uniform float u_vig;
uniform float u_grain;uniform float u_grain_sz;uniform float u_time;
uniform float u_shadows;uniform float u_highlights;uniform float u_tone;
uniform float u_de_active; 

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
float h2(vec2 p){p=fract(p*vec2(234.34,435.34));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float sn(vec2 u){vec2 i=floor(u),f=fract(u),s=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1,0)),s.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),s.x),s.y);}
float fbm(vec2 u){return sn(u)*.5+sn(u*2.)*.25+sn(u*4.)*.125;}
float gc(float l){float t=1.-abs(l-.5)*2.;return t*t*(3.-2.*t);}

void main(){
  vec2 vuv = cropUV(v_uv);
  vuv = clamp(vuv, 0.0, 1.0); 
  
  vec3 srgbIn = texture2D(u_vid_tex,vuv).rgb;
  vec3 linA = pow(srgbIn, vec3(2.2)) * u_ev;
  vec3 linear = linA;
  
  if(u_de_active > 0.5) {
    vec3 srgbFirst = texture2D(u_de_tex, vuv).rgb;
    vec3 linB = pow(srgbFirst, vec3(2.2)) * u_ev;
    linear = 1.0 - ((1.0 - clamp(linA, 0.0, 1.0)) * (1.0 - clamp(linB, 0.0, 1.0)));
  }
  
  float linLum = dot(linear, vec3(0.2126, 0.7152, 0.0722));
  
  float shadowMask = 1.0 - smoothstep(0.0, 0.4, linLum);
  float shadowFactor = 1.0 - u_shadows * 0.5;
  linear = mix(linear, pow(clamp(linear, 0.0, 1.0), vec3(shadowFactor)), shadowMask);
  
  float highlightMask = smoothstep(0.5, 1.0, linLum);
  float highlightFactor = 1.0 - u_highlights * 0.4;
  linear = mix(linear, pow(clamp(linear, 0.0, 1.0), vec3(highlightFactor)), highlightMask);
  
  vec3 srgbProcessed = pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 col = applyLUT(srgbProcessed);
  
  col.r+=u_tone*0.12;
  col.g+=u_tone*0.04;
  col.b-=u_tone*0.15;
  col=clamp(col,0.0,1.0);
  
  if(u_vig>0.){vec2 d=(v_uv-.5)*2.;float vig=smoothstep(.3,2.0,dot(d,d));col*=1.-u_vig*vig*.88;}
  if(u_grain>0.){float lum=dot(col,vec3(.299,.587,.114));vec2 nuv=v_uv*u_cvs_sz/(8./u_grain_sz)+vec2(u_time*.17,u_time*.13);float n=(fbm(nuv)-.5)*2.;col=clamp(col*(1.+n*u_grain*.45*gc(lum)),0.,1.);}
  
  gl_FragColor=vec4(col,1.);
}`;

let gl,prog,vtex,ltex,detex;
const U={};

function initGL(){
  if (!glCv) return false;
  gl=glCv.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  if(!gl)return false;
  const vs=mkS(gl.VERTEX_SHADER,VS),fs=mkS(gl.FRAGMENT_SHADER,FS);
  if(!vs||!fs)return false;
  prog=gl.createProgram();
  gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(prog));return false;}
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const al=gl.getAttribLocation(prog,'a_pos');
  gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  gl.uniform1i(gl.getUniformLocation(prog,'u_vid_tex'),0);
  gl.uniform1i(gl.getUniformLocation(prog,'u_lut_tex'),1);
  gl.uniform1i(gl.getUniformLocation(prog,'u_de_tex'),2);
  
  ['u_lut_sz','u_ev','u_vig','u_grain','u_grain_sz','u_time','u_zoom','u_cvs_sz','u_vid_sz','u_shadows','u_highlights','u_tone', 'u_de_active'].forEach(n=>U[n]=gl.getUniformLocation(prog,n));
  vtex=mkT();ltex=mkT();detex=mkT();
  return true;
}
function mkS(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}return s;}
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
  if(!S.ready||!vid||vid.readyState<2)return;
  const p=glCv.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(p.clientWidth * dpr);
  const bh = Math.round(p.clientHeight * dpr);
  if(glCv.width!==bw||glCv.height!==bh){
    glCv.width=bw;
    glCv.height=bh;
    gl.viewport(0,0,bw,bh);
  }
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);
  try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){return;}
  
  gl.uniform2f(U.u_cvs_sz,bw,bh);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
  gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
  gl.uniform1f(U.u_vig,S.vignette);gl.uniform1f(U.u_grain,S.grain);
  gl.uniform1f(U.u_grain_sz,S.grainSize);gl.uniform1f(U.u_time,performance.now()/1000);
  gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);
  
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, (S.deActive && S.deStage === 1) ? detex : vtex);
  gl.uniform1f(U.u_de_active, (S.deActive && S.deStage === 1) ? 1.0 : 0.0);
  
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ── Dial ── */
const MODES={
  exposure:   {min:-2,  max:2,   step:.05,hasCenter:true, fmt:v=>(v>0?'+':'')+v.toFixed(2)+' EV'},
  shadows:    {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  highlights: {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  tone:       {min:-1,  max:1,   step:.04,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  grain:      {min:0,   max:1,   step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
  vignette:   {min:0,   max:1,   step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
};
const TPX=14; 
let ddrag=false,dlast=0,doff=0;

function nT(){const m=MODES[S.mode];return Math.round((m.max-m.min)/m.step);}
function getV(){return{exposure:S.exposure,shadows:S.shadows,highlights:S.highlights,tone:S.tone,grain:S.grain,vignette:S.vignette}[S.mode];}
function setV(v){
  const m=MODES[S.mode];v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  if(S.mode==='exposure')S.exposure=v;else if(S.mode==='shadows')S.shadows=v;else if(S.mode==='highlights')S.highlights=v;else if(S.mode==='tone')S.tone=v;else if(S.mode==='grain')S.grain=v;else S.vignette=v;
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
        syncDial();
      }
    }
  });

  function handleVfPointerUp(e) {
    try { vfOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
    if (vfPointers.has(e.pointerId) && vfPointers.size === 1 && !isPinching) {
      triggerVfFocus(e);
    }
    vfPointers.delete(e.pointerId);
    if (vfPointers.size === 0) {
      isPinching = false;
    }
  }
  vfOverlay.addEventListener('pointerup', handleVfPointerUp);
  vfOverlay.addEventListener('pointercancel', handleVfPointerUp);
}

async function triggerVfFocus(e) {
  if (!vfOverlay) return;
  const r = vfOverlay.getBoundingClientRect();
  const rx = (e.clientX - r.left) / r.width;
  const ry = (e.clientY - r.top) / r.height;
  const ring = document.getElementById('focus-ring');
  if (ring) {
    ring.style.left = rx * 100 + '%';
    ring.style.top = ry * 100 + '%';
    ring.classList.remove('hidden');
    setTimeout(() => ring.classList.add('hidden'), 1300);
  }

  if (!S.stream) return;
  const tk = S.stream.getVideoTracks()[0];
  if (!tk) return;

  const vAR = S.vidW / S.vidH;
  let videoX = 0.5 + (rx - 0.5) / S.zoom;
  let videoY = 0.5 + (ry - 0.5) / S.zoom;
  if (vAR > 1) {
    videoX = 0.5 + (rx - 0.5) / (vAR * S.zoom);
  } else if (vAR < 1) {
    videoY = 0.5 + (ry - 0.5) * (vAR / S.zoom);
  }
  videoX = Math.max(0, Math.min(1, videoX));
  videoY = Math.max(0, Math.min(1, videoY));

  const focusLabel = document.getElementById('hud-focus-label');
  if (focusLabel) focusLabel.textContent = 'MF';
  try {
    await tk.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    await tk.applyConstraints({
      advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x: videoX, y: videoY }] }]
    });
  } catch (_) {
    try { await tk.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (__) {}
  }
  setTimeout(() => { if (focusLabel) focusLabel.textContent = 'AF'; }, 2000);
}

function tryLoadLuts(){ return Promise.resolve(); }

function buildFilmList(){
  const list=document.getElementById('film-list'); if(!list) return;
  list.innerHTML='';
  for(const[k,p]of Object.entries(PROF)){
    const it=document.createElement('div');it.className='film-item'+(S.simKey===k&&!S.cpuLut?' active':'');
    it.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${p.name}</div><div class="film-sub">${p.sub}</div></div>`;
    it.onclick=()=>{
      S.simKey=k;S.cpuLut=null;uploadLUT(p.lut);
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

// JAVÍTVA: Valós idejű élő dátum overlay frissítése, méretezése és pozicionálása
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
  
  const now = new Date(), p = n => String(n).padStart(2, '0');
  el.textContent = `${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
  el.classList.remove('hidden');
  
  const frame = getSelectedFrame();
  el.style.bottom = '12px';
  el.style.right = '12px';
  el.style.color = '#e8830a';
  
  if (frame === 'film') {
    el.style.bottom = 'calc(13% + 10px)'; // Intelligensen a filmcsík perforációja FÖLÉ ugrik
  } else if (frame === 'antik') {
    el.style.bottom = '24px'; // Beljebb igazodik az indák elkerüléséhez
    el.style.right = '24px';
    el.style.color = '#7a6440';
  }
}

function triggerMechanicalShutter(callback) {
  const blink = document.getElementById('shutter-blink');
  if(!blink) return callback();
  blink.classList.remove('hidden', 'open');
  blink.getBoundingClientRect(); 
  blink.classList.add('active'); 
  setTimeout(() => {
    callback(); 
    setTimeout(() => {
      blink.classList.add('open');
      blink.classList.remove('active');
      setTimeout(() => {
        blink.classList.add('hidden');
        blink.classList.remove('open');
      }, 160);
    }, 60);
  }, 120);
}

function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}

async function capture(){
  if(S.saving||!S.ready)return;
  
  if(S.deActive && S.deStage === 0) {
    triggerMechanicalShutter(() => {
      S.deStage = 1;
      const fl = document.getElementById('hud-focus-label');
      if (fl) fl.textContent = 'DE 2/2';
      const sh = document.getElementById('shutter');
      if (sh) sh.classList.add('de-primed');
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, detex);
      if (vid) {
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid); } catch(e){}
      }
    });
    return; 
  }

  triggerMechanicalShutter(async () => {
    S.saving=true;
    const OUT=1080;
    const frame = getSelectedFrame();
    let cw=OUT,ch=OUT,photoX=0,photoY=0,photoS=OUT;

    // JAVÍTVA: A filmcsík keret most már kitakarásos belső maszk, így megmarad a tökéletes négyzetes arány!
    if(frame==='antik'){
      photoS=OUT; photoX=0; photoY=0; cw=OUT; ch=OUT;
    } else if(frame==='polaroid'){
      const pad=Math.round(OUT*.06),bot=Math.round(OUT*.22);
      cw=OUT+pad*2;ch=OUT+pad+bot;photoX=pad;photoY=pad;photoS=OUT;
    } else if(frame==='film'){
      photoS=OUT; photoX=0; photoY=0; cw=OUT; ch=OUT;
    }

    const sv=document.getElementById('save-canvas'); if(!sv) return;
    sv.width=cw;sv.height=ch;
    const sCtx=sv.getContext('2d');

    if(frame==='polaroid'){sCtx.fillStyle='#f2ede4';} else {sCtx.fillStyle='#000';}
    sCtx.fillRect(0,0,cw,ch);

    if(S.ready&&vid&&vid.readyState>=2){
      const bw=glCv.width,bh=glCv.height;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);
      try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){}
      gl.uniform2f(U.u_cvs_sz,bw,bh);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
      gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
      gl.uniform1f(U.u_vig,S.vignette);gl.uniform1f(U.u_grain,S.grain);
      gl.uniform1f(U.u_grain_sz,S.grainSize);gl.uniform1f(U.u_time,performance.now()/1000);
      gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);
      
      if(S.deActive && S.deStage === 1) {
        gl.uniform1f(U.u_de_active, 1.0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, detex);
      } else {
        gl.uniform1f(U.u_de_active, 0.0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    const glW=glCv.width,glH=glCv.height;
    const pixels=new Uint8Array(glW*glH*4);
    gl.readPixels(0,0,glW,glH,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    
    const flipped=new Uint8Array(glW*glH*4);
    for(let row=0;row<glH;row++){
      const src=(glH-1-row)*glW*4,dst=row*glW*4;
      flipped.set(pixels.subarray(src,src+glW*4),dst);
    }

    const tmp = document.createElement('canvas'); tmp.width = photoS; tmp.height = photoS;
    const tc = tmp.getContext('2d', { willReadFrequently: true });
    const srcCanvas = document.createElement('canvas'); srcCanvas.width = glW; srcCanvas.height = glH;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped), glW, glH), 0, 0);
    tc.drawImage(srcCanvas, 0, 0, glW, glH, 0, 0, photoS, photoS);

    // Alap kép ráfestése
    sCtx.drawImage(tmp,photoX,photoY,photoS,photoS);

    // JAVÍTVA: Keretmaszkok ráfestése a fotó UTÁN (így kitakar, nem pedig kitolódik)
    if(frame==='antik'){
      try{
        const fimg=await loadImg('antik_keret_web.png');
        sCtx.drawImage(fimg,0,0,OUT,OUT);
      }catch(e){}
    } else if(frame==='film'){
      drawFilm(sCtx,cw,ch,Math.round(OUT*.13));
    }

    // JAVÍTVA: Keret-kompatibilis intelligens dátum elhelyezési koordináta-számlálás mentéskor
    const dateTog = document.getElementById('date-tog');
    if(dateTog && dateTog.checked){
      const now=new Date(),p=n=>String(n).padStart(2,'0');
      const ds=`${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
      const fs=Math.max(14,photoS*.036|0);
      sCtx.font=`bold ${fs}px Courier New`;sCtx.textAlign='right';
      
      let tx = photoX + photoS - fs * 0.5;
      let ty = photoY + photoS - fs * 0.5;
      
      if (frame === 'film') {
        ty = photoY + photoS - Math.round(OUT * 0.13) - fs * 0.4; // Tökéletesen a filmcsík belső perforációja FÖLÉ tolva
      } else if (frame === 'antik') {
        tx = photoX + photoS - fs * 1.6; // Beljebb húzva, hogy az antik sarokdísz ne takarja el
        ty = photoY + photoS - fs * 1.6;
      }
      
      sCtx.fillStyle='rgba(0,0,0,0.6)';
      sCtx.fillText(ds,tx+2,ty+2);
      
      sCtx.fillStyle=(frame==='antik')?'#7a6440':'#e8830a';
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
      if (previewImg && photoOverlay) {
        previewImg.src = url;
        photoOverlay.classList.remove('hidden');
      }
      
      if(S.deActive) {
        S.deStage = 0;
        const sh = document.getElementById('shutter'); if(sh) sh.classList.remove('de-primed');
        const fl = document.getElementById('hud-focus-label'); if(fl) fl.textContent = 'AF';
      }
      S.saving=false;
    },'image/jpeg',.92);
  });
}

/* JAVÍTVA: Ritkább, 1:1 precíz téglalap alapú perforáció kirajzolása mentéskor (tökéletesen egyezik a CSS-sel és nem törli ki a fotót) */
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
  if(S.stream) S.stream.getTracks().forEach(track => track.stop());
  try{
    const constraints = { audio:false, video:{ width:{ideal:1920}, height:{ideal:1920} } };
    if (preferredDeviceId) constraints.video.deviceId = { exact: preferredDeviceId };
    else constraints.video.facingMode = { ideal: 'environment' };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    S.stream=stream; if (vid) vid.srcObject=stream;
    if (vid) {
      vid.addEventListener('loadedmetadata',()=>{
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
        tk.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
        render();
      },{once:true});
    }
  }catch(e){
    const peEl = document.getElementById('perm-err');
    if (peEl) peEl.textContent=e.name==='NotAllowedError'?'Engedély megtagadva.':e.name==='NotFoundError'?'Nincs kamera.':'Kamera hiba.';
  }
}

const permBtn = document.getElementById('perm-btn'); if(permBtn) permBtn.addEventListener('click',() => initCam());
const shutterBtn = document.getElementById('shutter'); if(shutterBtn) shutterBtn.addEventListener('click',capture);

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');S.mode=btn.dataset.mode;buildDial();syncDial();
  });
});

const deTogBtn = document.getElementById('de-toggle-btn'); if(deTogBtn) deTogBtn.addEventListener('click', toggleDoubleExposure);
const camTogBtn = document.getElementById('cam-toggle-btn'); if(camTogBtn) camTogBtn.addEventListener('click', cycleCamera);

// Keretválasztás eseményfigyelők frissítése az élő dátum helyzetének szinkronizálásához is
document.querySelectorAll('input[name="frame-opt"]').forEach(radio => {
  radio.addEventListener('change', () => {
    updateLiveFramePreview();
    updateLiveDate();
  });
});

// Dátum gomb eseménykezelője a valós idejű overlay-hez
const dateTogEl = document.getElementById('date-tog');
if (dateTogEl) {
  dateTogEl.addEventListener('change', updateLiveDate);
}

// JAVÍTVA: Mentés gombra kattintás után azonnal letöltődik a kép ÉS bezáródik a mentési ablak
const photoSaveBtn = document.getElementById('photo-save-btn');
if (photoSaveBtn) {
  photoSaveBtn.onclick = () => {
    if (!activeBlobUrl) return;
    const a = document.createElement('a');
    a.href = activeBlobUrl;
    a.download = activeFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Az ablak azonnali bezárása mentés után
    const photoOverlay = document.getElementById('photo-overlay');
    if (photoOverlay) photoOverlay.classList.add('hidden');
  };
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
        if (actions) {
          actions.style.display = 'none';
        }
        
        setTimeout(() => {
          window.close();
        }, 1500);
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
    desc.innerHTML = "<span style='color: #c8a84b; font-weight: bold; display: block; margin-bottom: 8px;'>✓ SIKERES TELEPÍTÉS!</span>Ezt a lapot most már bezárhatod, és indíthatod az appot a kezdőképernyőről.";
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
      const ld=PROF[S.simKey]?.lut||S.cpuLut;
      if(ld)uploadLUT(ld);
      if(S.stream)render();
    });
  }

  buildDial();
  await loadExternalFilters();
  if (PROF['kodachrome']) {
    uploadLUT(PROF['kodachrome'].lut);
    const fl = document.getElementById('film-label'); if(fl) fl.textContent = PROF['kodachrome'].name;
  }
  syncDial();
  updateLiveFramePreview();
  updateLiveDate();
  await listVideoDevices();
  if(navigator.mediaDevices?.getUserMedia) initCam();
  else { const pe = document.getElementById('perm-err'); if(pe) pe.textContent='Kamera API nem támogatott.'; }
})();