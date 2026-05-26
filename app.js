'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v16 (Modular WYSIWYG Double Exposure Update)
   Features: Dynamic external folder-based injection arrays,
   iOS hardware shutter sync, mandatory WebGL unit 2 texture
   completeness binder, standalone installation routing.
═══════════════════════════════════════ */

// IDE ÍRD BE AZ ÚJONNAN LÉTREHOZOTT SZŰRŐFÁJLOK NEVÉT A FILTERS/ MAPPA ALATT:
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
  vuv = clamp(vuv, 0.0, 1.0); // BIZTONSÁGI FIX: elkerüli az UV túlcsordulásos fekete képernyőt
  
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

const glCv=document.getElementById('gl-canvas');
let gl,prog,vtex,ltex,detex;
const U={};

function initGL(){
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
function mkT(){const t=t||gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}

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
  if(!S.ready||vid.readyState<2)return;
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
  
  // SAFARI FIX: Mindig csatoljuk a TEXTURE2 egységet, különben az unbound textúra miatt a Safari lefagyasztja a rajzolást!
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, (S.deActive && S.deStage === 1) ? detex : vtex);
  gl.uniform1f(U.u_de_active, (S.deActive && S.deStage === 1) ? 1.0 : 0.0);
  
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ── Dial ── */
const MODES={
  exposure:   {min:-2,  max:2,   step:.05,hasCenter:true, fmt:v=>(v>0?'+':'')+v.toFixed(2)+' EV'},
  shadows:    {min:-1,  max:1,   step:.02,hasCenter:true, fmt:v=>(v>0?'+':'')+Math.round(v*100)+'%'},
  highlights: {min:-1,  max: