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
  videoW:0, videoH:0,   // actual video dimensions
};

/* ═══════════════════════════════════════════
   10 FILM PROFILES → pre-baked 33³ LUTs
═══════════════════════════════════════════ */
function sc(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
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
    let rn=sc(r,.55,1.6),gn=sc(g,.5,1.5),bn=sc(b,.48,1.45);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*2.5);
    rn+=l*.08;gn-=l*.02;bn-=l*.04;gn-=sh*.04;bn+=sh*.07;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.25,a+(gn-a)*1.1,a+(bn-a)*1.15];}},
  fuji_superia:{name:'FUJI SUPERIA 400',sub:'Teal shadows · Soft skin · Lifted blacks',fn(r,g,b){
    let rn=r*.93+.04,gn=g*.93+.04,bn=b*.93+.04;
    rn=sc(rn,.52,1.3);gn=sc(gn,.52,1.3);bn=sc(bn,.52,1.3);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*3),hi=Math.max(0,l*2-1);
    gn+=sh*.06;bn+=sh*.05;rn-=sh*.03;rn+=hi*.04;bn-=hi*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.9,a+(gn-a)*.92,a+(bn-a)*.88];}},
  fuji_velvia:{name:'FUJI VELVIA 50',sub:'Ultra saturated · Deep shadows · Vivid',fn(r,g,b){
    let rn=sc(r,.5,2.2),gn=sc(g,.5,2.0),bn=sc(b,.5,1.9);
    const a=(rn+gn+bn)/3;rn=a+(rn-a)*1.5;gn=a+(gn-a)*1.45;bn=a+(bn-a)*1.4;
    return[rn+.02,gn,bn-.02];}},
  kodak_portra:{name:'KODAK PORTRA 400',sub:'Natural skin · Pastel palette · Fine grain',fn(r,g,b){
    let rn=sc(r,.48,1.2),gn=sc(g,.5,1.15),bn=sc(b,.52,1.1);
    const l=.299*rn+.587*gn+.114*bn;rn+=l*.05;gn+=l*.02;bn-=l*.02;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.85,a+(gn-a)*.88,a+(bn-a)*.82];}},
  cinestill:{name:'CINESTILL 800T',sub:'Tungsten · Halation · Cinematic blue',fn(r,g,b){
    let rn=sc(r*.85,.5,1.4),gn=sc(g*.92,.5,1.3),bn=sc(b+.05,.5,1.25);
    const l=.299*rn+.587*gn+.114*bn,sh=Math.max(0,1-l*2.8),hi=Math.max(0,l*3-2);
    rn+=sh*.04+hi*.08;gn+=sh*.02-hi*.04;bn+=sh*.10;return[rn,gn,bn];}},
  agfa_vista:{name:'AGFA VISTA 200',sub:'Warm greens · Vintage fade · Soft',fn(r,g,b){
    let rn=sc(r*.9+.06,.52,1.1),gn=sc(g*.92+.04,.5,1.15),bn=sc(b*.85+.08,.5,1.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.82,a+(gn-a)*.88,a+(bn-a)*.75];}},
  cross_process:{name:'CROSS PROCESS',sub:'High saturation · Shifted hues · Punchy',fn(r,g,b){
    let rn=sc(r,.4,2.5),gn=sc(g,.5,2.2),bn=sc(b,.6,2.0);
    const a=(rn+gn+bn)/3;rn=a+(rn-a)*1.8;gn=a+(gn-a)*1.5;bn=a+(bn-a)*1.6;
    return[rn+.04,gn+.02,bn-.05];}},
  acros:{name:'B&W ACROS',sub:'High contrast · Optical channel mix',fn(r,g,b){
    let l=.35*r+.52*g+.13*b;l=sc(l,.5,2.0);
    if(l<.5)l*=.92;if(l>.85)l=.85+(l-.85)*.5;return[l,l,l];}},
  ilford_hp5:{name:'ILFORD HP5',sub:'Classic B&W · Wide latitude · Natural gray',fn(r,g,b){
    const l=sc(.299*r+.587*g+.114*b,.48,1.5);return[l,l,l];}},
  bw_soft:{name:'B&W SOFT',sub:'Low contrast · Airy · Faded blacks',fn(r,g,b){
    let l=.22*r+.64*g+.14*b;l=sc(l,.5,0.8)*0.8+0.10;return[l,l,l];}},
};
const PROFILES={};
for(const[k,d]of Object.entries(PROFILE_DEFS)) PROFILES[k]={name:d.name,sub:d.sub,lut:buildLut(d.fn)};
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
  const exp=sz*sz*sz*3;
  if(ent.length!==exp)throw new Error(`CUBE: ${ent.length}/${exp}`);
  return{d:new Float32Array(ent),sz};
}

/* ═══════════════════════════════════════════
   WEBGL — single-pass pipeline
   KEY FIX: u_video_ar uniform so shader crops
   video texture correctly without distortion
═══════════════════════════════════════════ */
const VERT=`
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv=vec2(a_pos.x*.5+.5, .5-a_pos.y*.5);
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
uniform vec2  u_res;       // canvas size px
uniform vec2  u_video_res; // video native size px
uniform float u_zoom;

// ── Cover-crop UV: fills canvas with video, no distortion ──
vec2 coverUV(vec2 uv){
  float canvasAR = u_res.x / u_res.y;
  float videoAR  = u_video_res.x / u_video_res.y;
  vec2 scale = vec2(1.0);
  if(videoAR > canvasAR){
    scale.x = canvasAR / videoAR;
  } else {
    scale.y = videoAR / canvasAR;
  }
  // Apply zoom (centered)
  scale /= u_zoom;
  vec2 centered = uv - 0.5;
  return centered * scale + 0.5;
}

// ── LUT trilinear (packed 2D: width=sz*sz height=sz) ──
vec3 applyLUT(vec3 c){
  float sz=u_lut_sz, sm=sz-1.0;
  vec3 s=clamp(c,0.,1.)*sm;
  vec3 lo=floor(s), hi=min(lo+1.,sm), t=s-lo;
  float W=sz*sz;
  #define SUV(RR,GG,BB) vec2(((BB)*sz+(RR)+.5)/W,((GG)+.5)/sz)
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

// ── FBM grain ──
float hash2(vec2 p){p=fract(p*vec2(234.34,435.34));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float sn(vec2 u){vec2 i=floor(u),f=fract(u),s=f*f*(3.-2.*f);return mix(mix(hash2(i),hash2(i+vec2(1,0)),s.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),s.x),s.y);}
float fbm(vec2 u){return sn(u)*.5+sn(u*2.)*.25+sn(u*4.)*.125;}
float grainCurve(float l){float t=1.-abs(l-.5)*2.;return t*t*(3.-2.*t);}

void main(){
  vec2 vuv=coverUV(v_uv);
  // Clamp: outside video → black
  if(vuv.x<0.||vuv.x>1.||vuv.y<0.||vuv.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}

  vec3 col=texture2D(u_video,vuv).rgb;

  // Exposure
  col=clamp(col*u_ev,0.,1.);

  // LUT
  col=applyLUT(col);

  // Vignette — gentler, wider falloff
  if(u_vig>0.){
    vec2 d=(v_uv-0.5)*2.0; // use v_uv (canvas coords), not vuv
    float r=dot(d,d);       // 0 center, ~2 corner
    float vig=smoothstep(0.2,2.0,r);
    col*=1.-u_vig*vig*0.85;
  }

  // Grain
  if(u_grain>0.){
    float lum=dot(col,vec3(.299,.587,.114));
    vec2 nuv=v_uv*u_res/(8./u_grain_sz)+vec2(u_time*.17,u_time*.13);
    float noise=fbm(nuv)*2.-1.;
    col=clamp(col+noise*u_grain*0.18*grainCurve(lum),0.,1.);
  }

  gl_FragColor=vec4(col,1.);
}`;

const glCanvas=document.getElementById('gl-canvas');
let gl,glProg,glVideoTex,glLutTex;
const glU={};

function initGL(){
  gl=glCanvas.getContext('webgl',{alpha:false,antialias:false,powerPreference:'high-performance'});
  if(!gl)return false;
  const vs=mkShader(gl.VERTEX_SHADER,VERT);
  const fs=mkShader(gl.FRAGMENT_SHADER,FRAG);
  if(!vs||!fs)return false;
  glProg=gl.createProgram();
  gl.attachShader(glProg,vs);gl.attachShader(glProg,fs);gl.linkProgram(glProg);
  if(!gl.getProgramParameter(glProg,gl.LINK_STATUS)){console.error(gl.getProgramInfoLog(glProg));return false;}
  gl.useProgram(glProg);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(glProg,'a_pos');
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  ['u_video','u_lut','u_lut_sz','u_ev','u_vig','u_grain','u_grain_sz','u_time','u_res','u_video_res','u_zoom']
    .forEach(n=>glU[n]=gl.getUniformLocation(glProg,n));
  glVideoTex=mkTex(gl.LINEAR);gl.uniform1i(glU.u_video,0);
  glLutTex=mkTex(gl.LINEAR);  gl.uniform1i(glU.u_lut,1);
  return true;
}
function mkShader(type,src){
  const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error(gl.getShaderInfoLog(s));return null;}
  return s;
}
function mkTex(filter){
  const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
  return t;
}

function uploadLutTex(lutData){
  const{d,sz}=lutData;
  const W=sz*sz,H=sz,rgba=new Uint8Array(W*H*4);
  for(let bi=0;bi<sz;bi++) for(let gi=0;gi<sz;gi++) for(let ri=0;ri<sz;ri++){
    const li=(bi*sz*sz+gi*sz+ri)*3;
    const ti=(gi*W+bi*sz+ri)*4;
    rgba[ti]=Math.round(d[li]*255);rgba[ti+1]=Math.round(d[li+1]*255);
    rgba[ti+2]=Math.round(d[li+2]*255);rgba[ti+3]=255;
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
    glCanvas.width=bw;glCanvas.height=bh;gl.viewport(0,0,bw,bh);
  }

  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,glVideoTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);

  gl.uniform1f(glU.u_ev,   Math.pow(2,S.ev));
  gl.uniform1f(glU.u_vig,  S.vignette);
  gl.uniform1f(glU.u_grain,S.grain);
  gl.uniform1f(glU.u_grain_sz,S.grainSize);
  gl.uniform1f(glU.u_time, performance.now()/1000);
  gl.uniform1f(glU.u_zoom, S.zoom);
  gl.uniform2f(glU.u_res,  bw, bh);
  gl.uniform2f(glU.u_video_res, S.videoW||bw, S.videoH||bh);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ═══════════════════════════════════════════
   DIAL — pointer events, fast & responsive
═══════════════════════════════════════════ */
const MODES={
  exposure:{min:-2,  max:2,  step:.05, def:0,  fmt:v=>(v>=0?'+':'')+v.toFixed(1)+' EV'},
  zoom:    {min:1.0, max:4.0,step:.05, def:1.0,fmt:v=>v.toFixed(2)+'×'},
  grain:   {min:0,   max:1,  step:.02, def:0,  fmt:v=>Math.round(v*100)+'%'},
  vignette:{min:0,   max:1,  step:.02, def:0,  fmt:v=>Math.round(v*100)+'%'},
};
const TICK_PX=14, TICKS=60;
let dialDrag=false,dialLast=0,dialOffset=0;

function getMV(){return{exposure:S.ev,zoom:S.zoom,grain:S.grain,vignette:S.vignette}[S.mode];}
function setMV(v){
  const m=MODES[S.mode];
  v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  switch(S.mode){
    case'exposure':S.ev=v;break;case'zoom':S.zoom=v;break;
    case'grain':S.grain=v;break;case'vignette':S.vignette=v;break;
  }
  return v;
}
function off2val(o){const m=MODES[S.mode];return m.def-o/(TICKS*TICK_PX)*(m.max-m.min);}
function val2off(v){const m=MODES[S.mode];return-(v-m.def)/(m.max-m.min)*TICKS*TICK_PX;}

function buildDials(){
  ['dial-ticks-p','dial-ticks-l'].forEach((id,idx)=>{
    const el=document.getElementById(id);if(!el)return;
    el.innerHTML='';
    const isV=idx===1;
    for(let i=0;i<TICKS;i++){
      const t=document.createElement('div');
      const maj=i%5===0,zero=i===TICKS/2;
      if(isV){
        t.className='dtv'+(maj?' maj':'')+(zero?' zero':'');
      }else{
        t.className='dt'+(maj?' maj':'')+(zero?' zero':'');
        t.style.height=(maj?26:14)+'px';
      }
      el.appendChild(t);
    }
  });
}

function syncDial(){
  const v=getMV(),o=val2off(v);
  dialOffset=o;
  const tp=document.getElementById('dial-ticks-p');
  const tl=document.getElementById('dial-ticks-l');
  if(tp)tp.style.transform=`translateX(${o}px)`;
  if(tl)tl.style.transform=`translateY(${-o}px)`;
  updateHUD(v);
}

function updateHUD(v){
  const m=MODES[S.mode];
  const fmt=m.fmt(v);
  document.getElementById('hud-mode-val').textContent=fmt;
  document.getElementById('hud-mode-name').textContent=S.mode.toUpperCase();
  if(S.mode==='exposure')document.getElementById('hud-ev').textContent=fmt;
  if(S.mode==='zoom')document.getElementById('hud-zoom').textContent=v.toFixed(1)+'×';
}

function dialMove(delta){
  dialOffset+=delta;
  const raw=off2val(dialOffset);
  const v=setMV(raw);
  dialOffset=val2off(v); // clamp
  const tp=document.getElementById('dial-ticks-p');
  const tl=document.getElementById('dial-ticks-l');
  if(tp)tp.style.transform=`translateX(${dialOffset}px)`;
  if(tl)tl.style.transform=`translateY(${-dialOffset}px)`;
  updateHUD(v);
}

function attachDial(elId,vertical){
  const el=document.getElementById(elId);if(!el)return;
  el.addEventListener('pointerdown',e=>{
    dialDrag=true;dialLast=vertical?e.clientY:e.clientX;
    el.setPointerCapture(e.pointerId);e.preventDefault();
  },{passive:false});
  el.addEventListener('pointermove',e=>{
    if(!dialDrag)return;
    const cur=vertical?e.clientY:e.clientX;
    const delta=vertical?-(cur-dialLast):cur-dialLast;
    dialLast=cur;dialMove(delta);e.preventDefault();
  },{passive:false});
  el.addEventListener('pointerup',()=>dialDrag=false);
  el.addEventListener('pointercancel',()=>dialDrag=false);
}

/* ═══════════════════════════════════════════
   FOCUS: tap-to-focus on viewfinder
═══════════════════════════════════════════ */
function setupFocus(){
  const overlay=document.getElementById('focus-overlay');
  const ring=document.getElementById('focus-ring');
  overlay.addEventListener('pointerdown',async e=>{
    const rect=overlay.getBoundingClientRect();
    const rx=(e.clientX-rect.left)/rect.width;
    const ry=(e.clientY-rect.top)/rect.height;
    ring.style.left=(rx*100)+'%';ring.style.top=(ry*100)+'%';
    ring.classList.remove('hidden');
    setTimeout(()=>ring.classList.add('hidden'),1400);
    if(!S.stream)return;
    const track=S.stream.getVideoTracks()[0];if(!track)return;
    try{await track.applyConstraints({advanced:[{focusMode:'manual',pointsOfInterest:[{x:rx,y:ry}]}]});}
    catch(_){try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(__){}}
    document.getElementById('hud-focus-label').textContent='MF';
    setTimeout(()=>document.getElementById('hud-focus-label').textContent='AF',2000);
  });
}

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
      }catch(err){console.warn('LUT skip:',e.file,err);}
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
    item.className='film-item'+(S.simKey==='__lut__'&&S.cpuLut===lut?' active':'');
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
   CAPTURE (CPU, native video res, 3:2 crop)
═══════════════════════════════════════════ */
function c255(v){return Math.max(0,Math.min(255,Math.round(v)));}

function cpuLUTApply(r,g,b,ld){
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
  let outW=vw,outH=vh;
  if(outW/outH>AR)outW=Math.round(outH*AR);else outH=Math.round(outW/AR);

  const frameVal=getFrameVal();
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
  // cover crop from video
  const vAR=vw/vh;
  let dw,dh;
  if(vAR>AR){dh=outH;dw=dh*vAR;}else{dw=outW;dh=dw/vAR;}
  dw/=S.zoom;dh/=S.zoom;
  tc.drawImage(vid,(outW-dw)/2,(outH-dh)/2,dw,dh);
  const id=tc.getImageData(0,0,outW,outH),pd=id.data;
  const evm=Math.pow(2,S.ev),va=S.vignette;
  const ld=S.simKey==='__lut__'&&S.cpuLut?S.cpuLut:PROFILES[S.simKey]?.lut;
  const vl=new Float32Array(outW*outH);
  const mx2=Math.sqrt((outW/2)**2+(outH/2)**2);
  for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){
    const dx=(x-outW/2)/(outW/2)*outW/outH,dy=(y-outH/2)/(outH/2);
    vl[y*outW+x]=dx*dx+dy*dy;
  }
  for(let i=0;i<pd.length;i+=4){
    const pi=i>>2;
    let r=Math.min(255,pd[i]*evm),g=Math.min(255,pd[i+1]*evm),b=Math.min(255,pd[i+2]*evm);
    if(ld){const rgb=cpuLUTApply(r,g,b,ld);r=rgb[0];g=rgb[1];b=rgb[2];}
    if(va>0){
      const r2=vl[pi];
      const vig=Math.max(0,Math.min(1,(r2-0.2)/(2.0-0.2)));
      const vm=1-va*vig*0.85;
      r*=vm;g*=vm;b*=vm;
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
    const nm=(PROFILES[S.simKey]?.name||document.getElementById('film-label').textContent||'CUSTOM').replace(/[ &]/g,'_');
    a.download=`ANALOGIA_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.jpg`;
    a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  },'image/jpeg',.95);
}

function getFrameVal(){
  const p=document.getElementById('frame-sel-p');
  const l=document.getElementById('frame-sel-l');
  return(p&&p.value!=='none')?p.value:(l?l.value:'none');
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
      video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
    S.stream=stream;vid.srcObject=stream;
    vid.addEventListener('loadedmetadata',()=>{
      S.ready=true;S.videoW=vid.videoWidth;S.videoH=vid.videoHeight;
      vid.play().catch(()=>{});
      document.getElementById('hud-res').textContent=vid.videoWidth+'×'+vid.videoHeight;
      document.getElementById('noperm').style.display='none';
      const track=stream.getVideoTracks()[0];
      if(track)track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
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

['shutter-p','shutter-l'].forEach(id=>{
  const btn=document.getElementById(id);if(!btn)return;
  btn.addEventListener('click',()=>{
    if(!S.ready)return;
    const core=btn.querySelector('.sh-core');
    core.style.transform='scale(.9)';setTimeout(()=>core.style.transform='',100);
    setTimeout(capture,40);
  });
});

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll(`.mode-btn[data-mode="${btn.dataset.mode}"]`).forEach(b=>b.classList.add('active'));
    S.mode=btn.dataset.mode;syncDial();
  });
});

['frame-sel-p','frame-sel-l'].forEach(id=>{
  const el=document.getElementById(id);if(!el)return;
  el.addEventListener('change',e=>{
    ['frame-sel-p','frame-sel-l'].forEach(oid=>{
      const o=document.getElementById(oid);if(o&&o!==el)o.value=e.target.value;});
  });
});

window.addEventListener('resize',()=>syncDial());

/* ═══════════════════════════════════════════
   BOOT
═══════════════════════════════════════════ */
(async function boot(){
  if(!initGL()){document.getElementById('perm-err').textContent='WebGL nem elérhető.';return;}
  buildDials();
  attachDial('dial-wrap-p',false);
  attachDial('dial-wrap-l',true);
  setupFocus();
  uploadLutTex(PROFILES['kodachrome'].lut);
  syncDial();
  await tryLoadLuts();
  if(navigator.mediaDevices?.getUserMedia)initCam();
  else document.getElementById('perm-err').textContent='Kamera API nem támogatott.';
})();
