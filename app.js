'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v22 (PERFORMANCE OPTIMIZED & FIXED)
═══════════════════════════════════════ */

const PROF = {};

const S={
  stream:null,raf:null,ready:false,saving:false,
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

let activeBlobUrl = null;
let activeFilename = "";
let flashEnabled = false;

// Teljesítmény-optimalizálás: Méretek gyorsítótárazása a Reflow elkerülésére
let cachedCanvasW = 0;
let cachedCanvasH = 0;

const vid = document.getElementById('vid');
const glCv = document.getElementById('gl-canvas');

// Globálisan újrahasznosított canvasok a capture memóriaszivárgásának megakadályozására
let memoTmpCanvas = null;
let memoSrcCanvas = null;

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
  const isPwaParam = urlParams.get('mode') === 'standalone';
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

  const promises = filters.map(f => {
    const isCube = (typeof f === 'object' && f.type === 'cube');
    const id = typeof f === 'string' ? f : f.id;
    
    if (isCube) {
      return fetch(`filters/${id}.cube`)
        .then(res => res.text())
        .then(text => {
          const lut = parseCube(text);
          if (lut.sz > 0) {
            PROF[id] = {
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
            PROF[id] = {
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

${window.FX && window.FX.shader ? window.FX.shader.helpers : ''}

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
  
  // FX (fényszivárgás) a képernyő-koordinátán fut, NEM a zoomolt vuv-on.
  // Így nagyításkor sem tűnik el, és a mentett képen is ugyanúgy látszik.
  vec2 vuv_saved=vuv; vuv=v_uv;
  ${window.FX && window.FX.shader ? window.FX.shader.calculation : ''}
  vuv=vuv_saved;
  
  if(u_vig>0.){vec2 d=(v_uv-.5)*2.;float vig=smoothstep(.3,2.0,dot(d,d));col*=1.-u_vig*vig*.88;}
  
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

let gl,prog,vtex,ltex,detex;
const U={};

function markUniformsDirty(){ /* no-op */ }

function updateCanvasDimensions() {
  if (!glCv || !glCv.parentElement) return;
  const p = glCv.parentElement;
  const dpr = window.devicePixelRatio || 1;
  
  // Ellenőrizzük, hogy aktív-e valamilyen LUT vagy egyéb nehéz effekt
  const heavyEffect = (window.FX && window.FX.active) || (S.grain > 0) || (S.simKey && PROF[S.simKey]);
  const fxScale = (heavyEffect && !S.saving) ? 0.5 : 1.0;
  
  // JAVÍTVA (Biztonsági őv): Ha a p.clientWidth még 0 (mert a DOM épp inicializálódik),
  // nem engedjük a méretet 0-ra esni, hanem adunk egy 320-as fallbacket. Így nincs u_cvs_sz 0-val való osztás a shaderben!
  const baseW = p.clientWidth || 320;
  const baseH = p.clientHeight || 320;
  
  cachedCanvasW = Math.max(4, Math.round(baseW * dpr * fxScale));
  cachedCanvasH = Math.max(4, Math.round(baseH * dpr * fxScale));
  
  if(glCv.width !== cachedCanvasW || glCv.height !== cachedCanvasH){
    glCv.width = cachedCanvasW;
    glCv.height = cachedCanvasH;
    if (gl) gl.viewport(0, 0, cachedCanvasW, cachedCanvasH);
    markUniformsDirty();
  }
}
window.addEventListener('resize', updateCanvasDimensions);

function initGL(){
  if (!glCv) return false;
  gl=glCv.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  if(!gl)return false;
  const vs=mkS(gl.VERTEX_SHADER,VS),fs=mkS(gl.FRAGMENT_SHADER,FS);
  if(!vs||!fs)return false;
  prog=gl.createProgram();
  gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){
    console.error('Shader fordítási hiba:', gl.getShaderInfoLog(vs));
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
  vtex=mkT();ltex=mkT();detex=mkT();
  
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
  if(!S.ready||!vid || vid.readyState<2)return;

  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);

  try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){return;}

  gl.uniform2f(U.u_cvs_sz,cachedCanvasW,cachedCanvasH);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
  gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
  gl.uniform1f(U.u_vig,S.vignette);
  gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);

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
  vignette:   {min:0,   max:1,   step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
};
const TPX=14; 
let ddrag=false,dlast=0,doff=0;

function nT(){const m=MODES[S.mode];return Math.round((m.max-m.min)/m.step);}
function getV(){return{exposure:S.exposure,shadows:S.shadows,highlights:S.highlights,tone:S.tone,grain:S.grain,vignette:S.vignette}[S.mode];}
function setV(v){
  const m=MODES[S.mode];v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  const prevGrain=S.grain;
  if(S.mode==='exposure')S.exposure=v;else if(S.mode==='shadows')S.shadows=v;else if(S.mode==='highlights')S.highlights=v;else if(S.mode==='tone')S.tone=v;else if(S.mode==='grain')S.grain=v;else S.vignette=v;
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
    const it=document.createElement('div');it.className='film-item'+(S.simKey===k?' active':'');
    it.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${p.name}</div><div class="film-sub">${p.sub}</div></div>`;
    it.onclick=()=>{
      S.simKey=k;uploadLUT(p.lut);
      markUniformsDirty();
      
      updateCanvasDimensions();
      
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
}

function toggleDust() {
  if (window.FX) {
    window.FX.active = !window.FX.active;
    const btn = document.getElementById('dust-toggle-btn');
    if (btn) btn.classList.toggle('active', window.FX.active);
    
    if (window.FX.active) {
      window.FX.randomize();
    }
    updateCanvasDimensions();
    markUniformsDirty();
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
    updateCanvasDimensions();

    if (window.FX && window.FX.active) { window.FX.seed = Math.random(); }

    let torchTrack = null;
    if (flashEnabled && S.mode === 'exposure' && S.stream) {
      const track = S.stream.getVideoTracks()[0];
      if (track && trackSupportsTorch(track)) {
        try {
          await track.applyConstraints({ advanced: [{ torch: true }] });
          torchTrack = track;
          await waitForVideoFrames(8, 450);
        } catch (_) { torchTrack = null; }
      }
    }
    
    const OUT=1080;
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

    const sv=document.getElementById('save-canvas'); if(!sv) return;
    sv.width=cw;sv.height=ch;
    const sCtx=sv.getContext('2d');

    if(frame==='polaroid'){sCtx.fillStyle='#f2ede4';} else {sCtx.fillStyle='#000';}
    sCtx.fillRect(0,0,cw,ch);

    if(S.ready&&vid&&vid.readyState>=2){
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);
      try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){}
      gl.uniform2f(U.u_cvs_sz,cachedCanvasW,cachedCanvasH);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
      gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.exposure));
      gl.uniform1f(U.u_vig,S.vignette);
      gl.uniform1f(U.u_shadows,S.shadows);gl.uniform1f(U.u_highlights,S.highlights);gl.uniform1f(U.u_tone,S.tone);
      
      gl.uniform1f(U.uGrainIntensity, S.grain * 0.2);
      gl.uniform1f(U.uGrainSize, 1.0 + S.grain * 2.5);
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
    memoSrcCanvas.width = cachedCanvasW; memoSrcCanvas.height = cachedCanvasH;
    
    const tc = memoTmpCanvas.getContext('2d');
    const srcCtx = memoSrcCanvas.getContext('2d');
    
    const pixels=new Uint8Array(cachedCanvasW*cachedCanvasH*4);
    gl.readPixels(0,0,cachedCanvasW,cachedCanvasH,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    
    if (torchTrack) {
      try { await torchTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch (_) {}
    }

    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), cachedCanvasW, cachedCanvasH), 0, 0);

    tc.save();
    tc.translate(0, photoS);
    tc.scale(1, -1);
    tc.drawImage(memoSrcCanvas, 0, 0, cachedCanvasW, cachedCanvasH, 0, 0, photoS, photoS);
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
      let ty = photoY + photoS - Math.round(OUT * 0.13) - fs * 0.4;
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
      if (previewImg && photoOverlay) {
        previewImg.src = url;
        previewImg.alt = fname;
        previewImg.setAttribute('data-filename', fname);
        photoOverlay.classList.remove('hidden');
      }
      
      if(S.deActive) {
        S.deStage = 0;
        const sh = document.getElementById('shutter'); if(sh) sh.classList.remove('de-primed');
        const fl = document.getElementById('hud-focus-label'); if(fl) fl.textContent = 'AF';
      }
      S.saving=false;
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
  if(S.stream) S.stream.getTracks().forEach(track => track.stop());
  markUniformsDirty();
  try{
    const constraints = { audio:false, video:{ width:{ideal:720}, height:{ideal:720} } };
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
        updateCanvasDimensions();
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
  
  updateCanvasDimensions();
  
  syncDial();
  syncDateToggleAvailability();
  updateLiveFramePreview();
  updateLiveDate();
  await listVideoDevices();
  if(navigator.mediaDevices?.getUserMedia) initCam();
  else { const pe = document.getElementById('perm-err'); if(pe) pe.textContent='Kamera API nem támogatott.'; }
})();