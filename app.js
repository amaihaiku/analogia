'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v16 (True WYSIWYG & Standalone Guard)
   Features: Linear light fusions, mechanical shutter blink,
   forced sandbox security check, cache busting matrices,
   automatic background downloads like native iOS.
═══════════════════════════════════════ */

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

/* ── Kezdőképernyő (Standalone Mode) Biztonsági Fal ── */
function checkStandaloneGuard() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const overlay = document.getElementById('install-overlay');
  const shell = document.querySelector('.shell');
  
  if (isStandalone) {
    // Ha már ki van rakva a főképernyőre és onnan indul: tiszta kameramód futtatása!
    if (overlay) overlay.classList.add('hidden');
    if (shell) shell.style.display = 'flex';
  } else {
    // Ha sima böngészőből nyitják meg: elrejtjük a kamerát, kényszerítjük a telepítést!
    if (shell) shell.style.display = 'none';
    if (overlay) overlay.classList.remove('hidden');
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

/* ── Film profiles ── */
function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
function cl(v){return Math.max(0,Math.min(1,v));}
function bake(fn){
  const N=33,lut=new Float32Array(N*N*N*3);
  for(let bi=0;bi<N;bi++)for(let gi=0;gi<N;gi++)for(let ri=0;ri<N;ri++){
    const[ro,go,bo]=fn(ri/(N-1),gi/(N-1),bi/(N-1));
    const i=(bi*N*N+gi*N+ri)*3;lut[i]=cl(ro);lut[i+1]=cl(go);lut[i+2]=cl(bo);
  }
  return{d:lut,sz:N};
}

const PD={
  kodachrome:{name:'KODACHROME 64',sub:'Rich contrast · Warm reds · Cyan shadows',fn(r,g,b){
    let rn=scv(r,.55,1.6),gn=scv(g,.5,1.5),bn=scv(b,.48,1.45);
    const l=.299*rn+.587*gn+.114*bn,s=Math.max(0,1-l*2.5);
    rn+=l*.08;gn-=l*.02;bn+=s*.07-l*.04;gn-=s*.04;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.25,a+(gn-a)*1.1,a+(bn-a)*1.15];}},
    
  kodak_portra:{name:'KODAK PORTRA 400',sub:'Natural skin · Pastel palette',fn(r,g,b){
    let rn=scv(r,.48,1.2),gn=scv(g,.5,1.15),bn=scv(b,.52,1.1);
    const l=.299*rn+.587*gn+.114*bn;rn+=l*.05;gn+=l*.02;bn-=l*.02;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.85,a+(gn-a)*.88,a+(bn-a)*.82];}},
    
  fuji_velvia:{name:'FUJI VELVIA 50',sub:'Ultra saturated · Deep shadows · Vivid',fn(r,g,b){
    let rn=scv(r,.5,2.2),gn=scv(g,.5,2.0),bn=scv(b,.5,1.9);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.5+.02,a+(gn-a)*1.45,a+(bn-a)*1.4-.02];}},
    
  cinestill:{name:'CINESTILL 800T',sub:'Tungsten · Halation · Cinematic blue',fn(r,g,b){
    let rn=scv(r*.85,.5,1.4),gn=scv(g*.92,.5,1.3),bn=scv(b+.05,.5,1.25);
    const l=.299*rn+.587*gn+.114*bn,s=Math.max(0,1-l*2.8),h_orig=Math.max(0,l*3-2);
    let rout=rn+s*.04+h_orig*.08, gout=gn+s*.02-h_orig*.04, bout=bn+s*.10;
    if(l>0.85){
      const t=Math.max(0,Math.min(1,(l-0.85)/0.15));
      const h=t*t*(3-2*t);
      rout+=0.15*h;
      bout-=0.04*h;
    }
    rout+=Math.max(0,l-0.85)*1.2;
    bout-=Math.max(0,l-0.85)*0.4;
    return[rout,gout,bout];}},
    
  teal_orange:{name:'TEAL & ORANGE',sub:'Hollywood grade · Skin warmth · Teal shadows',fn(r,g,b){
    const l=.299*r+.587*g+.114*b,s=Math.max(0,1-l*2.5),h=Math.max(0,l*2-1),m=1-s-h;
    let rn=r-s*.18+h*.12+m*.04,gn=g+s*.06+h*.04,bn=b+s*.14-h*.16-m*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.3,a+(gn-a)*1.1,a+(bn-a)*1.25];}},
    
  bleach:{name:'BLEACH BYPASS',sub:'Silver retention · High contrast · Desaturated',fn(r,g,b){
    const l=.299*r+.587*g+.114*b,lc=scv(l,.5,2.2),s=Math.max(0,1-l*3);
    return[r*.4+lc*.6,g*.4+lc*.6+s*.03,b*.4+lc*.6+s*.05];}},
    
  cross:{name:'CROSS PROCESS',sub:'High saturation · Shifted hues',fn(r,g,b){
    let rn=scv(r,.4,2.5),gn=scv(g,.5,2.2),bn=scv(b,.6,2.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.8+.04,a+(gn-a)*1.5+.02,a+(bn-a)*1.6-.05];}},
    
  highcontrast_bw:{name:'HIGH CONTRAST',sub:'Crushed blacks · Clean whites · Graphic',fn(r,g,b){
    let l=0.25*r+0.65*g+0.10*b;
    l=scv(l,0.42,3.5);
    if(l<0.25)l*=0.6;
    if(l>0.75)l=0.75+(l-0.75)*1.3;
    return[l,l,l];}},
    
  l_monochrome:{name:'L-MONOCHROME',sub:'Leica rendering · Rich midtones · Airy',fn(r,g,b){
    let l=0.30*r+0.59*g+0.11*b;
    l=scv(l,0.50,1.1);
    const t=1-Math.abs(l-0.5)*2;l+=t*0.04;
    if(l<0.3)l=l*0.88+0.035;
    if(l>0.88)l=0.88+(l-0.88)*0.4;
    return[l,l,l];}},
    
  infrared:{name:'INFRARED',sub:'Green becomes white · Sky darkens · Dramatic',fn(r,g,b){
    let l=0.05*r+0.88*g+0.07*b;
    l=scv(l,0.45,2.2);
    l-=b*0.08;
    l=Math.max(0,Math.min(1,l));
    let rout=l+Math.max(0,l-0.7)*0.12;
    let gout=l+Math.max(0,l-0.7)*0.04;
    let bout=l-Math.max(0,l-0.7)*0.08;
    return[rout,gout,bout];}}
};

const PROF={};
for(const[k,d]of Object.entries(PD))PROF[k]={name:d.name,sub:d.sub,lut:bake(d.fn)};
const XLUTS={};

/* ── Cube parser ── */
function parseCube(txt){
  const lines=txt.split('\n');let sz=33;const e=[];
  for(let ln of lines){
    ln=ln.trim();
    if(!ln||ln[0]==='#'||ln.startsWith('TITLE'))continue;
    if(ln.startsWith('LUT_3D_SIZE')){sz=+ln.split(/\s+/)[1];continue;}
    if(ln.startsWith('DOMAIN_')||ln.startsWith('LUT_'))continue;
    const p=ln.split(/\s+/).map(Number);
    if(p.length===3&&!p.some(isNaN))e.push(p[0],p[1],p[2]);
  }
  if(e.length!==sz*sz*sz*3)throw new Error(`CUBE: ${e.length}/${sz*sz*sz*3}`);
  return{d:new Float32Array(e),sz};
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
  vec2 vuv=cropUV(v_uv);
  if(any(lessThan(vuv,vec2(0.)))||any(greaterThan(vuv,vec2(1.)))){gl_FragColor=vec4(0.,0.,0.,1.);return;}
  
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
function mkT(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);return t;}

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

const vid=document.getElementById('vid');

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
  
  if(S.deActive && S.deStage === 1) {
    gl.uniform1f(U.u_de_active, 1.0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detex);
  } else {
    gl.uniform1f(U.u_de_active, 0.0);
  }
  
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
dialEl.addEventListener('pointerdown',e=>{ddrag=true;dlast=e.clientX;dialEl.setPointerCapture(e.pointerId);},{passive:true});
dialEl.addEventListener('pointermove',e=>{if(!ddrag)return;dMove(e.clientX-dlast);dlast=e.clientX;},{passive:true});
dialEl.addEventListener('pointerup',()=>ddrag=false);
dialEl.addEventListener('pointercancel',()=>ddrag=false);

/* ── Tap-to-focus & Pinch-to-zoom ── */
const vfOverlay = document.getElementById('focus-overlay');
let vfPointers = new Map();
let vfInitDist = 0;
let vfInitZoom = 1.0;
let isPinching = false;

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

async function triggerVfFocus(e) {
  const r = vfOverlay.getBoundingClientRect();
  const rx = (e.clientX - r.left) / r.width;
  const ry = (e.clientY - r.top) / r.height;
  const ring = document.getElementById('focus-ring');
  ring.style.left = rx * 100 + '%';
  ring.style.top = ry * 100 + '%';
  ring.classList.remove('hidden');
  setTimeout(() => ring.classList.add('hidden'), 1300);

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

  document.getElementById('hud-focus-label').textContent = 'MF';
  try {
    await tk.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    await tk.applyConstraints({
      advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x: videoX, y: videoY }] }]
    });
  } catch (_) {
    try { await tk.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (__) {}
  }
  setTimeout(() => document.getElementById('hud-focus-label').textContent = 'AF', 2000);
}

/* ── Landscape warning ── */
function chkOrientation(){document.getElementById('rotate-overlay').classList.toggle('hidden',!window.matchMedia('(orientation:landscape)').matches);}
window.addEventListener('resize',()=>{chkOrientation();const dw=document.getElementById('dial-wrap'),cl=document.querySelector('.dial-center-h');if(dw&&cl)cl.style.left=dw.clientWidth/2+'px';});
window.matchMedia('(orientation:landscape)').addEventListener('change',chkOrientation);
chkOrientation();

/* ── Film modal ── */
async function tryLoadLuts(){
  try{
    const r=await fetch('luts/index.json');if(!r.ok)return;
    for(const e of((await r.json()).luts||[])){
      try{const r2=await fetch(`luts/${e.file}`);if(!r2.ok)continue;const lut=parseCube(await r2.text());XLUTS[e.file]={d:lut.d,sz:lut.sz,name:e.name||e.file,sub:e.sub||'Custom LUT'};}catch(_){}
    }
  }catch(_){}
}
function buildFilmList(){
  const list=document.getElementById('film-list');list.innerHTML='';
  for(const[k,p]of Object.entries(PROF)){
    const it=document.createElement('div');it.className='film-item'+(S.simKey===k&&!S.cpuLut?' active':'');
    it.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${p.name}</div><div class="film-sub">${p.sub}</div></div>`;
    it.onclick=()=>{S.simKey=k;S.cpuLut=null;uploadLUT(p.lut);document.getElementById('film-label').textContent=p.name;closeModal();};
    list.appendChild(it);
  }
  for(const[fn,lut]of Object.entries(XLUTS)){
    const it=document.createElement('div');it.className='film-item';
    it.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${lut.name}</div><div class="film-sub">${lut.sub}</div></div>`;
    it.onclick=()=>{S.simKey='__lut__';S.cpuLut=lut;uploadLUT(lut);document.getElementById('film-label').textContent=lut.name;closeModal();};
    list.appendChild(it);
  }
}
function openModal(){buildFilmList();document.getElementById('film-modal').classList.remove('hidden');}
function closeModal(){document.getElementById('film-modal').classList.add('hidden');}
document.getElementById('film-btn').addEventListener('click',openModal);
document.getElementById('modal-close').addEventListener('click',closeModal);
document.getElementById('modal-backdrop').addEventListener('click',closeModal);
document.getElementById('lut-upload').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  try{const lut=parseCube(await f.text());const name=f.name.replace('.cube','').replace(/_/g,' ').toUpperCase();XLUTS[f.name]={d:lut.d,sz:lut.sz,name,sub:'Egyéni LUT · .cube'};S.simKey='__lut__';S.cpuLut=XLUTS[f.name];uploadLUT(lut);document.getElementById('film-label').textContent=name;closeModal();}
  catch(err){alert('LUT hiba: '+err.message);}e.target.value='';
});

/* ── DOUBLE EXPOSURE INTERACTION CONTROLLER ── */
function toggleDoubleExposure() {
  S.deActive = !S.deActive;
  S.deStage = 0;
  const btn = document.getElementById('de-toggle-btn');
  const sht = document.getElementById('shutter');
  btn.classList.toggle('active', S.deActive);
  sht.classList.remove('de-primed');
  document.getElementById('hud-focus-label').textContent = 'AF';
}

/* ── CAPTURE ── */
function getSelectedFrame() {
  const activeRadio = document.querySelector('input[name="frame-opt"]:checked');
  return activeRadio ? activeRadio.value : 'none';
}

/* BLENDE ANIMÁCIÓ CONTROLLER (iOS REDŐNYZÁR MÁSOLAT) */
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
      document.getElementById('hud-focus-label').textContent = 'DE 2/2';
      document.getElementById('shutter').classList.add('de-primed');
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, detex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
    });
    return; 
  }

  // Zársebességi blende animáció indítása
  triggerMechanicalShutter(async () => {
    S.saving=true;
    const OUT=1080;
    const frame = getSelectedFrame();
    let cw=OUT,ch=OUT,photoX=0,photoY=0,photoS=OUT;

    if(frame==='antik'){
      photoS=OUT; photoX=0; photoY=0; cw=OUT; ch=OUT;
    } else if(frame==='polaroid'){
      const pad=Math.round(OUT*.06),bot=Math.round(OUT*.22);
      cw=OUT+pad*2;ch=OUT+pad+bot;photoX=pad;photoY=pad;photoS=OUT;
    } else if(frame==='film'){
      const sh=Math.round(OUT*.13);ch=OUT+sh*2;photoX=0;photoY=sh;photoS=OUT;
    }

    const sv=document.getElementById('save-canvas');
    sv.width=cw;sv.height=ch;
    const sCtx=sv.getContext('2d');

    if(frame==='polaroid'){sCtx.fillStyle='#f2ede4';} else {sCtx.fillStyle='#000';}
    sCtx.fillRect(0,0,cw,ch);
    if(frame==='film')drawFilm(sCtx,cw,ch,Math.round(OUT*.13));

    if(S.ready&&vid.readyState>=2){
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

    if(frame==='antik'){
      sCtx.drawImage(tmp,0,0,OUT,OUT);
      try{
        const fimg=await loadImg('antik_keret_web.png');
        sCtx.drawImage(fimg,0,0,OUT,OUT);
      }catch(e){}
    } else {
      sCtx.drawImage(tmp,photoX,photoY,photoS,photoS);
    }

    if(document.getElementById('date-tog').checked){
      const now=new Date(),p=n=>String(n).padStart(2,'0');
      const ds=`${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
      const fs=Math.max(14,photoS*.036|0);
      sCtx.font=`bold ${fs}px Courier New`;sCtx.textAlign='right';
      const tx=photoX+photoS-fs*.4,ty=photoY+photoS-fs*.5;
      sCtx.fillStyle='rgba(0,0,0,.4)';sCtx.fillText(ds,tx+2,ty+2);
      sCtx.fillStyle=(frame==='antik')?'#7a6440':'#e8830a';
      sCtx.fillText(ds,tx,ty);
    }

    if(frame==='polaroid'){
      const fs=Math.round(OUT*.026);
      sCtx.font=`${fs}px Courier New`;sCtx.textAlign='right';sCtx.fillStyle='#5a5040';
      sCtx.fillText('by Analogia',photoX+photoS-Math.round(OUT*.02),ch-Math.round((ch-photoY-photoS)/2+fs*.3));
    }

    /* PRÉMIUM FIX: Teljesen elnyomjuk a külső felugró Lightbox ablakot. A blende lecsengése után a kész kép automatikusan letöltődik a háttérben (mint az iOS-en), így egy tizedmásodpercre sem akad meg a folyamatos fotózás! */
    sv.toBlob(blob=>{
      const now=new Date(),p=n=>String(n).padStart(2,'0');
      const nm=(PROF[S.simKey]?.name||'CUSTOM').replace(/[ &]/g,'_');
      const fname=`Analogia_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.jpg`;
      
      if(S.lastPhotoUrl)URL.revokeObjectURL(S.lastPhotoUrl);
      const url=URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      
      if(S.deActive) {
        S.deStage = 0;
        document.getElementById('shutter').classList.remove('de-primed');
        document.getElementById('hud-focus-label').textContent = 'AF';
      }
      S.saving=false;
    },'image/jpeg',.92);
  });
}

function drawFilm(c,W,H,sh){
  c.fillStyle='#111008';c.fillRect(0,0,W,H);
  [0,H-sh].forEach(sy=>{
    c.fillStyle='#1e1c17';c.fillRect(0,sy,W,sh);
    const hw=sh*.5|0,hh=sh*.55|0,sp=hw*2.2,hy=sy+(sh-hh)/2;
    c.fillStyle='#0a0904';let x=sp*.25;
    while(x<W-hw){c.beginPath();if(c.roundRect)c.roundRect(x,hy,hw,hh,3);else c.rect(x,hy,hw,hh);c.fill();x+=sp;}
  });
}

/* ── Hardveres sávváltó ── */
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
  if (nextDevice) {
    await initCam(nextDevice.deviceId);
  }
}

async function initCam(preferredDeviceId = null){
  if(S.stream) {
    S.stream.getTracks().forEach(track => track.stop());
  }
  try{
    const constraints = {
      audio:false,
      video:{ width:{ideal:1920}, height:{ideal:1920} }
    };
    if (preferredDeviceId) {
      constraints.video.deviceId = { exact: preferredDeviceId };
    } else {
      constraints.video.facingMode = { ideal: 'environment' };
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    S.stream=stream;vid.srcObject=stream;
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
      document.getElementById('hud-res').textContent=S.vidW+'×'+S.vidH;
      document.getElementById('noperm').style.display='none';
      tk.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
      render();
    },{once:true});
  }catch(e){
    document.getElementById('perm-err').textContent=e.name==='NotAllowedError'?'Engedély megtagadva.':e.name==='NotFoundError'?'Nincs kamera.':'Kamera hiba.';
  }
}

function _pzPreventNative(e) { e.preventDefault(); }
function lockOverlayZoom() {
  const overlay = document.getElementById('photo-overlay');
  overlay.style.touchAction = 'none';
  overlay.addEventListener('gesturestart', _pzPreventNative, { passive: false });
  overlay.addEventListener('gesturechange', _pzPreventNative, { passive: false });
  overlay.addEventListener('touchmove', _pzPreventNative, { passive: false });
}
function unlockOverlayZoom() {
  const overlay = document.getElementById('photo-overlay');
  overlay.removeEventListener('gesturestart', _pzPreventNative);
  overlay.removeEventListener('gesturechange', _pzPreventNative);
  overlay.removeEventListener('touchmove', _pzPreventNative);
  overlay.style.touchAction = '';
}

/* ── Events ── */
document.getElementById('perm-btn').addEventListener('click',() => initCam());
document.getElementById('shutter').addEventListener('click',capture);

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');S.mode=btn.dataset.mode;buildDial();syncDial();
  });
});

document.getElementById('de-toggle-btn').addEventListener('click', toggleDoubleExposure);
document.getElementById('cam-toggle-btn').addEventListener('click', cycleCamera);

/* NATIVE OPERATING REDIRECT FOR INSTALL SELECTION BUTTONS */
document.getElementById('native-install-btn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    window.close();
  } else {
    const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isiOS) {
      alert("iOS eszközön: Kattintson a Safari alján lévő 'Megosztás' gombra, majd válaszd a 'Hozzáadás a kezdőképernyőhöz' opciót!");
    } else {
      alert("A böngésző még nem készítette elő a telepítést. Kérjük, használja a böngésző jobb felső menüjében a 'Telepítés' vagy 'Hozzáadás a főképernyőhöz' opciót!");
    }
  }
});

document.getElementById('cancel-install-btn').addEventListener('click', () => {
  window.close();
});

document.getElementById('exit-btn').addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(()=>{});
  } else {
    if(S.stream) {
      S.stream.getTracks().forEach(t=>t.stop());
      S.ready = false;
      document.getElementById('noperm').style.display = 'flex';
    }
    window.close();
  }
});

document.getElementById('photo-overlay-bg').addEventListener('click',()=>{
  unlockOverlayZoom();
  document.getElementById('photo-overlay').classList.add('hidden');
  const img=document.getElementById('photo-preview-img');
  img.src='';
  if(S.lastPhotoUrl){URL.revokeObjectURL(S.lastPhotoUrl);S.lastPhotoUrl=null;}
});

document.getElementById('photo-overlay-close').addEventListener('click',()=>{
  unlockOverlayZoom();
  document.getElementById('photo-overlay').classList.add('hidden');
  document.getElementById('photo-preview-img').src='';
  if(S.lastPhotoUrl){URL.revokeObjectURL(S.lastPhotoUrl);S.lastPhotoUrl=null;}
});

document.getElementById('photo-save-btn').addEventListener('click',()=>{
  const img=document.getElementById('photo-preview-img');
  if(!img.src)return;
  const a=document.createElement('a');
  a.href=img.src;a.download=img.getAttribute('data-filename')||'Analogia.jpg';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>{
    unlockOverlayZoom();
    document.getElementById('photo-overlay').classList.add('hidden');
    img.src='';
    if(S.lastPhotoUrl){URL.revokeObjectURL(S.lastPhotoUrl);S.lastPhotoUrl=null;}
  },400);
});

document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('gesturechange', e => e.preventDefault());
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

/* ── Boot ── */
(async()=>{
  checkStandaloneGuard(); // Első biztonsági ellenőrzés a betöltéskor
  if(!initGL()){document.getElementById('perm-err').textContent='WebGL nem elérhető.';return;}
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

  buildDial();syncDial();uploadLUT(PROF['kodachrome'].lut);
  await tryLoadLuts();
  await listVideoDevices();
  if(navigator.mediaDevices?.getUserMedia) initCam();
  else document.getElementById('perm-err').textContent='Kamera API nem támogatott.';
})();