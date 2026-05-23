'use strict';

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
const S = {
  stream:null, raf:null, ready:false,
  simKey:'kodachrome', cpuLut:null,
  lutSize:33,
  ev:0, zoom:1.0, grain:0, grainSize:2.0, vignette:0,
  mode:'exposure',
  videoW:1, videoH:1,
};

/* ═══════════════════════════════════════════
   12 FILM PROFILES
═══════════════════════════════════════════ */
function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
function cl(v){return Math.max(0,Math.min(1,v));}
function buildLut(fn){
  const sz=33,lut=new Float32Array(sz*sz*sz*3);
  for(let bi=0;bi<sz;bi++) for(let gi=0;gi<sz;gi++) for(let ri=0;ri<sz;ri++){
    const r=ri/(sz-1),g=gi/(sz-1),b=bi/(sz-1);
    const[ro,go,bo]=fn(r,g,b);
    const i=(bi*sz*sz+gi*sz+ri)*3;
    lut[i]=cl(ro);lut[i+1]=cl(go);lut[i+2]=cl(bo);
  }
  return{d:lut,sz};
}

const PROFILE_DEFS={
  kodachrome:{name:'KODACHROME 64',sub:'Rich contrast · Warm reds · Cyan shadows',fn(r,g,b){
    let rn=scv(r,.55,1.6),gn=scv(g,.5,1.5),bn=scv(b,.48,1.45);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*2.5);
    rn+=l*.08;gn-=l*.02;bn-=l*.04;gn-=sh*.04;bn+=sh*.07;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.25,a+(gn-a)*1.1,a+(bn-a)*1.15];}},

  fuji_superia:{name:'FUJI SUPERIA 400',sub:'Teal shadows · Soft skin · Lifted blacks',fn(r,g,b){
    let rn=r*.93+.04,gn=g*.93+.04,bn=b*.93+.04;
    rn=scv(rn,.52,1.3);gn=scv(gn,.52,1.3);bn=scv(bn,.52,1.3);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*3),hi=Math.max(0,l*2-1);
    gn+=sh*.06;bn+=sh*.05;rn-=sh*.03;rn+=hi*.04;bn-=hi*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.9,a+(gn-a)*.92,a+(bn-a)*.88];}},

  fuji_velvia:{name:'FUJI VELVIA 50',sub:'Ultra saturated · Deep shadows · Vivid',fn(r,g,b){
    let rn=scv(r,.5,2.2),gn=scv(g,.5,2.0),bn=scv(b,.5,1.9);
    const a=(rn+gn+bn)/3;rn=a+(rn-a)*1.5;gn=a+(gn-a)*1.45;bn=a+(bn-a)*1.4;
    return[rn+.02,gn,bn-.02];}},

  kodak_portra:{name:'KODAK PORTRA 400',sub:'Natural skin · Pastel palette · Fine grain',fn(r,g,b){
    let rn=scv(r,.48,1.2),gn=scv(g,.5,1.15),bn=scv(b,.52,1.1);
    const l=.299*rn+.587*gn+.114*bn;rn+=l*.05;gn+=l*.02;bn-=l*.02;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.85,a+(gn-a)*.88,a+(bn-a)*.82];}},

  cinestill:{name:'CINESTILL 800T',sub:'Tungsten · Halation · Cinematic blue',fn(r,g,b){
    let rn=scv(r*.85,.5,1.4),gn=scv(g*.92,.5,1.3),bn=scv(b+.05,.5,1.25);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*2.8),hi=Math.max(0,l*3-2);
    rn+=sh*.04+hi*.08;gn+=sh*.02-hi*.04;bn+=sh*.10;return[rn,gn,bn];}},

  /* NEW: Teal & Orange */
  teal_orange:{name:'TEAL & ORANGE',sub:'Hollywood grade · Skin warmth · Teal shadows',fn(r,g,b){
    const l=.299*r+.587*g+.114*b;
    const sh=Math.max(0,1-l*2.5),hi=Math.max(0,l*2-1),mid=1-sh-hi;
    // Shadows → teal (green+blue up, red down)
    let rn=r-sh*.18, gn=g+sh*.06, bn=b+sh*.14;
    // Highlights → orange (red+green up, blue down)
    rn=rn+hi*.12; gn=gn+hi*.04; bn=bn-hi*.16;
    // Midtone slight orange push on skin
    rn=rn+mid*.04; bn=bn-mid*.03;
    // Saturation boost
    const av=(rn+gn+bn)/3;
    rn=av+(rn-av)*1.3;gn=av+(gn-av)*1.1;bn=av+(bn-av)*1.25;
    return[rn,gn,bn];}},

  /* NEW: Cinematic Bleach Bypass */
  bleach_bypass:{name:'BLEACH BYPASS',sub:'Silver retention · High contrast · Desaturated',fn(r,g,b){
    // Bleach bypass: overlays desaturated high-contrast layer
    const l=.299*r+.587*g+.114*b;
    const lc=scv(l,.5,2.2); // high contrast luma
    // Blend color with high-contrast mono 60/40
    let rn=r*.4+lc*.6, gn=g*.4+lc*.6, bn=b*.4+lc*.6;
    // Slight blue-green lift in shadows
    const sh=Math.max(0,1-l*3);
    gn+=sh*.03;bn+=sh*.05;
    return[rn,gn,bn];}},

  agfa_vista:{name:'AGFA VISTA 200',sub:'Warm greens · Vintage fade · Soft',fn(r,g,b){
    let rn=scv(r*.9+.06,.52,1.1),gn=scv(g*.92+.04,.5,1.15),bn=scv(b*.85+.08,.5,1.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.82,a+(gn-a)*.88,a+(bn-a)*.75];}},

  cross_process:{name:'CROSS PROCESS',sub:'High saturation · Shifted hues · Punchy',fn(r,g,b){
    let rn=scv(r,.4,2.5),gn=scv(g,.5,2.2),bn=scv(b,.6,2.0);
    const a=(rn+gn+bn)/3;rn=a+(rn-a)*1.8;gn=a+(gn-a)*1.5;bn=a+(bn-a)*1.6;
    return[rn+.04,gn+.02,bn-.05];}},

  acros:{name:'B&W ACROS',sub:'High contrast · Optical channel mix',fn(r,g,b){
    let l=.35*r+.52*g+.13*b;l=scv(l,.5,2.0);
    if(l<.5)l*=.92;if(l>.85)l=.85+(l-.85)*.5;return[l,l,l];}},

  ilford_hp5:{name:'ILFORD HP5',sub:'Classic B&W · Wide latitude · Natural gray',fn(r,g,b){
    const l=scv(.299*r+.587*g+.114*b,.48,1.5);return[l,l,l];}},

  bw_soft:{name:'B&W SOFT',sub:'Low contrast · Airy · Faded blacks',fn(r,g,b){
    let l=.22*r+.64*g+.14*b;l=scv(l,.5,0.8)*0.8+0.10;return[l,l,l];}},
};

const PROFILES={};
for(const[k,d]of Object.entries(PROFILE_DEFS))
  PROFILES[k]={name:d.name,sub:d.sub,lut:buildLut(d.fn)};
const LOADED_LUTS={};

/* ═══════════════════════════════════════════
   CUBE PARSER
═══════════════════════════════════════════ */
function parseCube(txt){
  const lines=txt.split('\n');let sz=33;const ent=[];
  for(let line of lines){
    line=line.trim();
    if(!line||line.startsWith('#')||line.startsWith('TITLE'))continue;
    if(line.startsWith('LUT_3D_SIZE')){sz=parseInt(line.split(/\s+/)[1]);continue;}
    if(line.startsWith('DOMAIN_')||line.startsWith('LUT_'))continue;
    const p=line.split(/\s+/).map(Number);
    if(p.length===3&&!p.some(isNaN))ent.push(p[0],p[1],p[2]);
  }
  if(ent.length!==sz*sz*sz*3)throw new Error(`CUBE: ${ent.length}/${sz*sz*sz*3}`);
  return{d:new Float32Array(ent),sz};
}

/* ═══════════════════════════════════════════
   WEBGL
   FIX: coverUV now correctly handles portrait
   video (1080×1920) on landscape canvas and
   vice versa, eliminating the wavy distortion.
═══════════════════════════════════════════ */
const VERT=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv=vec2(a_pos.x*.5+.5,.5-a_pos.y*.5);
  gl_Position=vec4(a_pos,0.,1.);
}`;

const FRAG=`
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform sampler2D u_lut;
uniform float u_lut_sz;
uniform float u_ev;
uniform float u_vig;
uniform float u_grain;
uniform float u_grain_sz;
uniform float u_time;
uniform vec2  u_canvas;    // canvas pixel size
uniform vec2  u_video;     // video native pixel size
uniform float u_zoom;

// Cover-crop: fill canvas from video without distortion
// Handles portrait video (e.g. 1080x1920) on 3:2 canvas
vec2 coverUV(vec2 uv){
  float cAR=u_canvas.x/u_canvas.y;
  float vAR=u_video.x/u_video.y;
  vec2 scale;
  if(vAR>cAR){ scale=vec2(cAR/vAR,1.0); }
  else        { scale=vec2(1.0,vAR/cAR); }
  scale/=u_zoom;
  return (uv-0.5)*scale+0.5;
}

// Trilinear LUT lookup (packed 2D texture: W=sz*sz, H=sz)
vec3 applyLUT(vec3 c){
  float sz=u_lut_sz,sm=sz-1.;
  vec3 s=clamp(c,0.,1.)*sm;
  vec3 lo=floor(s),hi=min(lo+1.,sm),t=s-lo;
  float W=sz*sz;
  #define SUV(R,G,B) vec2(((B)*sz+(R)+.5)/W,((G)+.5)/sz)
  vec3 c000=texture2D(u_lut,SUV(lo.r,lo.g,lo.b)).rgb;
  vec3 c100=texture2D(u_lut,SUV(hi.r,lo.g,lo.b)).rgb;
  vec3 c010=texture2D(u_lut,SUV(lo.r,hi.g,lo.b)).rgb;
  vec3 c110=texture2D(u_lut,SUV(hi.r,hi.g,lo.b)).rgb;
  vec3 c001=texture2D(u_lut,SUV(lo.r,lo.g,hi.b)).rgb;
  vec3 c101=texture2D(u_lut,SUV(hi.r,lo.g,hi.b)).rgb;
  vec3 c011=texture2D(u_lut,SUV(lo.r,hi.g,hi.b)).rgb;
  vec3 c111=texture2D(u_lut,SUV(hi.r,hi.g,hi.b)).rgb;
  vec3 c00=mix(c000,c100,t.r),c10=mix(c010,c110,t.r);
  vec3 c01=mix(c001,c101,t.r),c11=mix(c011,c111,t.r);
  return mix(mix(c00,c10,t.g),mix(c01,c11,t.g),t.b);
}

// Organic FBM grain
float h2(vec2 p){p=fract(p*vec2(234.34,435.34));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float sn(vec2 u){vec2 i=floor(u),f=fract(u),s=f*f*(3.-2.*f);
  return mix(mix(h2(i),h2(i+vec2(1,0)),s.x),mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),s.x),s.y);}
float fbm(vec2 u){return sn(u)*.5+sn(u*2.)*.25+sn(u*4.)*.125;}
float gc(float l){float t=1.-abs(l-.5)*2.;return t*t*(3.-2.*t);}

void main(){
  vec2 vuv=coverUV(v_uv);
  if(vuv.x<0.||vuv.x>1.||vuv.y<0.||vuv.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}

  vec3 col=texture2D(u_video,vuv).rgb;
  col=clamp(col*u_ev,0.,1.);
  col=applyLUT(col);

  // Vignette — gentle, only at edges
  if(u_vig>0.){
    vec2 d=(v_uv-0.5)*2.0;
    float r=dot(d,d); // 0=center, 2=corner
    float vig=smoothstep(0.4,2.2,r);
    col*=1.-u_vig*vig*0.9;
  }

  // Grain
  if(u_grain>0.){
    float lum=dot(col,vec3(.299,.587,.114));
    vec2 nuv=v_uv*u_canvas/(8./u_grain_sz)+vec2(u_time*.17,u_time*.13);
    float noise=fbm(nuv)*2.-1.;
    col=clamp(col+noise*u_grain*0.2*gc(lum),0.,1.);
  }

  gl_FragColor=vec4(col,1.);
}`;

const glCanvas=document.getElementById('gl-canvas');
let gl,glProg,glVidTex,glLutTex;
const glU={};

function initGL(){
  gl=glCanvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance'});
  if(!gl)return false;
  const vs=mkSh(gl.VERTEX_SHADER,VERT);
  const fs=mkSh(gl.FRAGMENT_SHADER,FRAG);
  if(!vs||!fs)return false;
  glProg=gl.createProgram();
  gl.attachShader(glProg,vs);gl.attachShader(glProg,fs);gl.linkProgram(glProg);
  if(!gl.getProgramParameter(glProg,gl.LINK_STATUS)){
    console.error('GL link:',gl.getProgramInfoLog(glProg));return false;}
  gl.useProgram(glProg);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(glProg,'a_pos');
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  ['u_video','u_lut','u_lut_sz','u_ev','u_vig','u_grain','u_grain_sz',
   'u_time','u_canvas','u_video','u_zoom'].forEach(n=>glU[n]=gl.getUniformLocation(glProg,n));
  // Fix: correct uniform names
  glU.u_canvas_=gl.getUniformLocation(glProg,'u_canvas');
  glU.u_video_=gl.getUniformLocation(glProg,'u_video');
  glVidTex=mkTex(gl.LINEAR);gl.uniform1i(gl.getUniformLocation(glProg,'u_video'),0);
  glLutTex=mkTex(gl.LINEAR);gl.uniform1i(gl.getUniformLocation(glProg,'u_lut'),1);
  // Fetch all uniforms cleanly
  const names=['u_lut_sz','u_ev','u_vig','u_grain','u_grain_sz','u_time','u_zoom'];
  const vec2s=['u_canvas','u_video'];
  names.forEach(n=>glU[n]=gl.getUniformLocation(glProg,n));
  vec2s.forEach(n=>glU[n]=gl.getUniformLocation(glProg,n));
  return true;
}
function mkSh(type,src){
  const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}
  return s;
}
function mkTex(f){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f);
  return t;
}

function uploadLutTex(lutData){
  const{d,sz}=lutData;
  const W=sz*sz,H=sz,rgba=new Uint8Array(W*H*4);
  for(let bi=0;bi<sz;bi++) for(let gi=0;gi<sz;gi++) for(let ri=0;ri<sz;ri++){
    const li=(bi*sz*sz+gi*sz+ri)*3;
    const ti=(gi*W+bi*sz+ri)*4;
    rgba[ti  ]=Math.round(d[li  ]*255);
    rgba[ti+1]=Math.round(d[li+1]*255);
    rgba[ti+2]=Math.round(d[li+2]*255);
    rgba[ti+3]=255;
  }
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,glLutTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  S.lutSize=sz;gl.uniform1f(glU.u_lut_sz,sz);
}

/* ═══════════════════════════════════════════
   RENDER LOOP
═══════════════════════════════════════════ */
const vid=document.getElementById('vid');

function renderFrame(){
  S.raf=requestAnimationFrame(renderFrame);
  if(!S.ready||vid.readyState<2)return;

  const bezel=glCanvas.parentElement;
  const bw=bezel.clientWidth|0, bh=bezel.clientHeight|0;
  if(glCanvas.width!==bw||glCanvas.height!==bh){
    glCanvas.width=bw;glCanvas.height=bh;
    gl.viewport(0,0,bw,bh);
  }

  // Upload video frame — the KEY fix:
  // texImage2D with the video element directly handles all orientation
  // without distortion as long as we pass correct video resolution to shader
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D,glVidTex);
  try{
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);
  }catch(e){return;}

  gl.uniform1f(glU.u_ev,    Math.pow(2,S.ev));
  gl.uniform1f(glU.u_vig,   S.vignette);
  gl.uniform1f(glU.u_grain, S.grain);
  gl.uniform1f(glU.u_grain_sz, S.grainSize);
  gl.uniform1f(glU.u_time,  performance.now()/1000);
  gl.uniform1f(glU.u_zoom,  S.zoom);
  gl.uniform2f(glU.u_canvas, bw, bh);
  // Pass actual video track dimensions (not element dimensions)
  gl.uniform2f(glU.u_video,  S.videoW, S.videoH);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ═══════════════════════════════════════════
   DIAL
═══════════════════════════════════════════ */
const MODES={
  exposure:{min:-2,  max:2,  step:.05,def:0,  fmt:v=>(v>=0?'+':'')+v.toFixed(1)+' EV'},
  zoom:    {min:1.0, max:4.0,step:.05,def:1.0,fmt:v=>v.toFixed(1)+'×'},
  grain:   {min:0,   max:1,  step:.02,def:0,  fmt:v=>Math.round(v*100)+'%'},
  vignette:{min:0,   max:1,  step:.02,def:0,  fmt:v=>Math.round(v*100)+'%'},
};
const TICK_PX=13,TICKS=60;
let dialDrag=false,dialLast=0,dialOff=0;

function getMV(){return{exposure:S.ev,zoom:S.zoom,grain:S.grain,vignette:S.vignette}[S.mode];}
function setMV(v){
  const m=MODES[S.mode];
  v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  if(S.mode==='exposure')S.ev=v;
  else if(S.mode==='zoom')S.zoom=v;
  else if(S.mode==='grain')S.grain=v;
  else S.vignette=v;
  return v;
}
function o2v(o){const m=MODES[S.mode];return m.def-o/(TICKS*TICK_PX)*(m.max-m.min);}
function v2o(v){const m=MODES[S.mode];return-(v-m.def)/(m.max-m.min)*TICKS*TICK_PX;}

function buildDial(){
  const el=document.getElementById('dial-ticks-p');if(!el)return;
  el.innerHTML='';
  for(let i=0;i<TICKS;i++){
    const t=document.createElement('div');
    const maj=i%5===0,zero=i===TICKS/2;
    t.className='dt'+(maj?' maj':'')+(zero?' zero':'');
    t.style.height=(maj?28:15)+'px';
    el.appendChild(t);
  }
}

function syncDial(){
  const v=getMV(),o=v2o(v);dialOff=o;
  const el=document.getElementById('dial-ticks-p');
  if(el)el.style.transform=`translateX(${o}px)`;
  updateHUD(v);
}

function updateHUD(v){
  const m=MODES[S.mode],fmt=m.fmt(v);
  document.getElementById('hud-mode-val').textContent=fmt;
  document.getElementById('hud-mode-name').textContent=S.mode.toUpperCase();
  if(S.mode==='exposure')document.getElementById('hud-ev').textContent=fmt;
  if(S.mode==='zoom')document.getElementById('hud-zoom')?document.getElementById('hud-zoom').textContent=v.toFixed(1)+'×':null;
}

function dialMove(dx){
  dialOff+=dx;
  const v=setMV(o2v(dialOff));
  dialOff=v2o(v);
  const el=document.getElementById('dial-ticks-p');
  if(el)el.style.transform=`translateX(${dialOff}px)`;
  updateHUD(v);
}

const dialEl=document.getElementById('dial-wrap-p');
dialEl.addEventListener('pointerdown',e=>{
  dialDrag=true;dialLast=e.clientX;
  dialEl.setPointerCapture(e.pointerId);e.preventDefault();
},{passive:false});
dialEl.addEventListener('pointermove',e=>{
  if(!dialDrag)return;
  dialMove(e.clientX-dialLast);dialLast=e.clientX;e.preventDefault();
},{passive:false});
dialEl.addEventListener('pointerup',()=>dialDrag=false);
dialEl.addEventListener('pointercancel',()=>dialDrag=false);

/* ═══════════════════════════════════════════
   TAP-TO-FOCUS
═══════════════════════════════════════════ */
document.getElementById('focus-overlay').addEventListener('pointerdown',async e=>{
  const rect=e.currentTarget.getBoundingClientRect();
  const rx=(e.clientX-rect.left)/rect.width,ry=(e.clientY-rect.top)/rect.height;
  const ring=document.getElementById('focus-ring');
  ring.style.left=(rx*100)+'%';ring.style.top=(ry*100)+'%';
  ring.classList.remove('hidden');setTimeout(()=>ring.classList.add('hidden'),1400);
  if(!S.stream)return;
  const track=S.stream.getVideoTracks()[0];if(!track)return;
  try{await track.applyConstraints({advanced:[{focusMode:'manual',pointsOfInterest:[{x:rx,y:ry}]}]});}
  catch(_){try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(__){}}
  document.getElementById('hud-focus-label').textContent='MF';
  setTimeout(()=>document.getElementById('hud-focus-label').textContent='AF',2000);
});

/* ═══════════════════════════════════════════
   LANDSCAPE DETECTION → show rotate overlay
═══════════════════════════════════════════ */
function checkOrientation(){
  const overlay=document.getElementById('rotate-overlay');
  const isLandscape=window.matchMedia('(orientation:landscape)').matches;
  overlay.classList.toggle('hidden',!isLandscape);
}
window.addEventListener('resize',checkOrientation);
window.matchMedia('(orientation:landscape)').addEventListener('change',checkOrientation);
checkOrientation();

/* ═══════════════════════════════════════════
   FILM MODAL
═══════════════════════════════════════════ */
async function tryLoadLuts(){
  try{
    const res=await fetch('luts/index.json');if(!res.ok)return;
    const json=await res.json();
    for(const e of(json.luts||[])){
      try{
        const r2=await fetch(`luts/${e.file}`);if(!r2.ok)continue;
        const lut=parseCube(await r2.text());
        LOADED_LUTS[e.file]={d:lut.d,sz:lut.sz,name:e.name||e.file,sub:e.sub||'Custom LUT'};
      }catch(err){console.warn('LUT skip:',e.file);}
    }
  }catch(_){}
}

function buildFilmList(){
  const list=document.getElementById('film-list');list.innerHTML='';
  for(const[key,prof]of Object.entries(PROFILES)){
    const item=document.createElement('div');
    item.className='film-item'+(S.simKey===key&&!S.cpuLut?' active':'');
    item.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${prof.name}</div><div class="film-sub">${prof.sub}</div></div>`;
    item.addEventListener('click',()=>{
      S.simKey=key;S.cpuLut=null;uploadLutTex(prof.lut);
      document.getElementById('film-label').textContent=prof.name;closeModal();});
    list.appendChild(item);
  }
  for(const[fname,lut]of Object.entries(LOADED_LUTS)){
    const item=document.createElement('div');
    item.className='film-item';
    item.innerHTML=`<div class="film-dot"></div><div><div class="film-name">${lut.name}</div><div class="film-sub">${lut.sub}</div></div>`;
    item.addEventListener('click',()=>{
      S.simKey='__lut__';S.cpuLut=lut;uploadLutTex(lut);
      document.getElementById('film-label').textContent=lut.name;closeModal();});
    list.appendChild(item);
  }
}

function openModal(){buildFilmList();document.getElementById('film-modal').classList.remove('hidden');}
function closeModal(){document.getElementById('film-modal').classList.add('hidden');}
document.getElementById('film-btn').addEventListener('click',openModal);
document.getElementById('modal-close').addEventListener('click',closeModal);
document.getElementById('modal-backdrop').addEventListener('click',closeModal);
document.getElementById('lut-upload').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const lut=parseCube(await file.text());
    const name=file.name.replace('.cube','').replace(/_/g,' ').toUpperCase();
    LOADED_LUTS[file.name]={d:lut.d,sz:lut.sz,name,sub:'Egyéni LUT · .cube'};
    S.simKey='__lut__';S.cpuLut=LOADED_LUTS[file.name];uploadLutTex(lut);
    document.getElementById('film-label').textContent=name;closeModal();
  }catch(err){alert('LUT hiba: '+err.message);}
  e.target.value='';
});

/* ═══════════════════════════════════════════
   CAPTURE — uses current zoom, saves 3:2
═══════════════════════════════════════════ */
function c255(v){return Math.max(0,Math.min(255,Math.round(v)));}

function cpuLUT(r,g,b,ld){
  const{d,sz}=ld,sc2=sz-1,rf=r/255*sc2,gf=g/255*sc2,bf=b/255*sc2;
  const r0=Math.floor(rf),r1=Math.min(r0+1,sz-1);
  const g0=Math.floor(gf),g1=Math.min(g0+1,sz-1);
  const b0=Math.floor(bf),b1=Math.min(b0+1,sz-1);
  const dr=rf-r0,dg=gf-g0,db=bf-b0;
  const idx=(a,c,dd)=>(dd*sz*sz+c*sz+a)*3;
  return[0,1,2].map(ch=>{
    const v000=d[idx(r0,g0,b0)+ch],v100=d[idx(r1,g0,b0)+ch];
    const v010=d[idx(r0,g1,b0)+ch],v110=d[idx(r1,g1,b0)+ch];
    const v001=d[idx(r0,g0,b1)+ch],v101=d[idx(r1,g0,b1)+ch];
    const v011=d[idx(r0,g1,b1)+ch],v111=d[idx(r1,g1,b1)+ch];
    const c00=v000+(v100-v000)*dr,c10=v010+(v110-v010)*dr;
    const c01=v001+(v101-v001)*dr,c11=v011+(v111-v011)*dr;
    return(c00+(c10-c00)*dg+(c01+(c11-c01)*dg-c00-(c10-c00)*dg)*db)*255;
  });
}

function capture(){
  const vw=vid.videoWidth,vh=vid.videoHeight;if(!vw||!vh)return;
  const AR=3/2;
  // Crop video to 3:2 at current zoom
  const vAR=vw/vh;
  let srcW,srcH;
  if(vAR>AR){srcH=vh/S.zoom;srcW=srcH*AR;}
  else{srcW=vw/S.zoom;srcH=srcW/AR;}
  srcW=Math.min(srcW,vw);srcH=Math.min(srcH,vh);
  const srcX=(vw-srcW)/2,srcY=(vh-srcH)/2;

  const outW=Math.round(Math.min(srcW,1920));
  const outH=Math.round(outW/AR);

  const frameVal=document.getElementById('frame-sel-p').value;
  let cw=outW,ch=outH,cx=0,cy=0;
  const ps=Math.round(outW*.05),pb=Math.round(outW*.18),sh=Math.round(outH*.13);
  if(frameVal==='polaroid'){cw=outW+ps*2;ch=outH+ps+pb;cx=ps;cy=ps;}
  else if(frameVal==='film'){ch=outH+sh*2;cy=sh;}

  const sv=document.getElementById('save-canvas');
  sv.width=cw;sv.height=ch;
  const sCtx=sv.getContext('2d');
  if(frameVal==='polaroid'){sCtx.fillStyle='#f4f0e8';sCtx.fillRect(0,0,cw,ch);}
  else if(frameVal==='film'){drawFilm(sCtx,cw,ch,sh);}
  else{sCtx.fillStyle='#000';sCtx.fillRect(0,0,cw,ch);}

  const tmp=document.createElement('canvas');tmp.width=outW;tmp.height=outH;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  // Draw the zoomed crop from video
  tc.drawImage(vid,srcX,srcY,srcW,srcH,0,0,outW,outH);

  const id=tc.getImageData(0,0,outW,outH),pd=id.data;
  const evm=Math.pow(2,S.ev),va=S.vignette;
  const ld=S.simKey==='__lut__'&&S.cpuLut?S.cpuLut:PROFILES[S.simKey]?.lut;

  for(let i=0;i<pd.length;i+=4){
    let r=Math.min(255,pd[i]*evm),g=Math.min(255,pd[i+1]*evm),b=Math.min(255,pd[i+2]*evm);
    if(ld){const rgb=cpuLUT(r,g,b,ld);r=rgb[0];g=rgb[1];b=rgb[2];}
    if(va>0){
      const pi=i>>2,x=pi%outW,y=Math.floor(pi/outW);
      const dx=(x/outW-.5)*2,dy=(y/outH-.5)*2;
      const r2=dx*dx+dy*dy;
      const vig=Math.max(0,Math.min(1,(r2-.4)/(2.2-.4)));
      const vm=1-va*vig*0.9;r*=vm;g*=vm;b*=vm;
    }
    pd[i]=c255(r);pd[i+1]=c255(g);pd[i+2]=c255(b);
  }
  tc.putImageData(id,0,0);
  sCtx.drawImage(tmp,cx,cy,outW,outH);

  if(document.getElementById('date-tog').checked)burnDate(sCtx,cx+outW,cy+outH);
  if(frameVal==='polaroid'){
    sCtx.fillStyle='#5a5040';sCtx.font=`bold ${Math.round(ch*.024)}px Courier New`;
    sCtx.textAlign='center';sCtx.fillText('ANALOGIA RF-1',cw/2,ch-Math.round(ch*.03));
  }

  sv.toBlob(blob=>{
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    const now=new Date(),p=n=>String(n).padStart(2,'0');
    const nm=(PROFILES[S.simKey]?.name||'CUSTOM').replace(/[ &]/g,'_');
    a.download=`ANALOGIA_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.jpg`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  },'image/jpeg',.95);
}

function drawFilm(c,W,H,sh){
  c.fillStyle='#111008';c.fillRect(0,0,W,H);
  [0,H-sh].forEach(sy=>{
    c.fillStyle='#1e1c17';c.fillRect(0,sy,W,sh);
    const hw=Math.round(sh*.5),hh=Math.round(sh*.55),sp=hw*2.2,hy=sy+(sh-hh)/2;
    c.fillStyle='#0a0904';let x=sp*.25;
    while(x<W-hw){c.beginPath();if(c.roundRect)c.roundRect(x,hy,hw,hh,3);else c.rect(x,hy,hw,hh);c.fill();x+=sp;}
  });
}
function burnDate(c,rx,ry){
  const now=new Date(),p=n=>String(n).padStart(2,'0');
  const ds=`${p(now.getMonth()+1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
  const fs=Math.max(16,Math.round(ry*.04));
  c.font=`bold ${fs}px Courier New`;c.textAlign='right';
  c.fillStyle='rgba(0,0,0,.5)';c.fillText(ds,rx-fs*.5+2,ry-fs*.5+2);
  c.fillStyle='#e8830a';c.fillText(ds,rx-fs*.5,ry-fs*.5);
}

/* ═══════════════════════════════════════════
   CAMERA
═══════════════════════════════════════════ */
async function initCam(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},
      audio:false,
    });
    S.stream=stream;vid.srcObject=stream;
    vid.addEventListener('loadedmetadata',()=>{
      S.ready=true;
      // Store the ACTUAL track dimensions (may differ from element)
      const track=stream.getVideoTracks()[0];
      const settings=track.getSettings();
      S.videoW=settings.width||vid.videoWidth;
      S.videoH=settings.height||vid.videoHeight;
      vid.play().catch(()=>{});
      document.getElementById('hud-res').textContent=S.videoW+'×'+S.videoH;
      document.getElementById('noperm').style.display='none';
      track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
      renderFrame();
    },{once:true});
  }catch(e){
    let msg='Kamera hiba.';
    if(e.name==='NotAllowedError')msg='Engedély megtagadva.';
    if(e.name==='NotFoundError')msg='Nincs kamera.';
    document.getElementById('perm-err').textContent=msg;
  }
}

/* ═══════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════ */
document.getElementById('perm-btn').addEventListener('click',initCam);

document.getElementById('shutter-p').addEventListener('click',()=>{
  if(!S.ready)return;
  const core=document.querySelector('#shutter-p .sh-core');
  core.style.transform='scale(.88) translateY(2px)';
  setTimeout(()=>core.style.transform='',110);
  setTimeout(capture,45);
});

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    S.mode=btn.dataset.mode;syncDial();
  });
});

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
(async function boot(){
  if(!initGL()){document.getElementById('perm-err').textContent='WebGL nem elérhető.';return;}
  buildDial();syncDial();
  uploadLutTex(PROFILES['kodachrome'].lut);
  await tryLoadLuts();
  if(navigator.mediaDevices?.getUserMedia)initCam();
  else document.getElementById('perm-err').textContent='Kamera API nem támogatott.';
})();
