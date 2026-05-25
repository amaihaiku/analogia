'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — app.js v9
   Fixes: topbar font, antik frame black bg,
   faster capture via reduced output size
═══════════════════════════════════════ */

const S={
  stream:null,raf:null,ready:false,saving:false,
  simKey:'kodachrome',cpuLut:null,
  ev:0,zoom:1.0,grain:0,grainSize:2,vignette:0,
  mode:'exposure',
  vidW:1,vidH:1,
  lastPhotoUrl:null,
};

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
  fuji_superia:{name:'FUJI SUPERIA 400',sub:'Teal shadows · Soft skin · Lifted blacks',fn(r,g,b){
    let rn=r*.93+.04,gn=g*.93+.04,bn=b*.93+.04;
    rn=scv(rn,.52,1.3);gn=scv(gn,.52,1.3);bn=scv(bn,.52,1.3);
    const l=.299*rn+.587*gn+.114*bn,s=Math.max(0,1-l*3),h=Math.max(0,l*2-1);
    gn+=s*.06;bn+=s*.05;rn+=h*.04-s*.03;bn-=h*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.9,a+(gn-a)*.92,a+(bn-a)*.88];}},
  fuji_velvia:{name:'FUJI VELVIA 50',sub:'Ultra saturated · Deep shadows · Vivid',fn(r,g,b){
    let rn=scv(r,.5,2.2),gn=scv(g,.5,2.0),bn=scv(b,.5,1.9);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.5+.02,a+(gn-a)*1.45,a+(bn-a)*1.4-.02];}},
  kodak_portra:{name:'KODAK PORTRA 400',sub:'Natural skin · Pastel palette',fn(r,g,b){
    let rn=scv(r,.48,1.2),gn=scv(g,.5,1.15),bn=scv(b,.52,1.1);
    const l=.299*rn+.587*gn+.114*bn;rn+=l*.05;gn+=l*.02;bn-=l*.02;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.85,a+(gn-a)*.88,a+(bn-a)*.82];}},
  cinestill:{name:'CINESTILL 800T',sub:'Tungsten · Halation · Cinematic blue',fn(r,g,b){
    let rn=scv(r*.85,.5,1.4),gn=scv(g*.92,.5,1.3),bn=scv(b+.05,.5,1.25);
    const l=.299*rn+.587*gn+.114*bn,s=Math.max(0,1-l*2.8),h=Math.max(0,l*3-2);
    return[rn+s*.04+h*.08,gn+s*.02-h*.04,bn+s*.10];}},
  teal_orange:{name:'TEAL & ORANGE',sub:'Hollywood grade · Skin warmth · Teal shadows',fn(r,g,b){
    const l=.299*r+.587*g+.114*b,s=Math.max(0,1-l*2.5),h=Math.max(0,l*2-1),m=1-s-h;
    let rn=r-s*.18+h*.12+m*.04,gn=g+s*.06+h*.04,bn=b+s*.14-h*.16-m*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.3,a+(gn-a)*1.1,a+(bn-a)*1.25];}},
  bleach:{name:'BLEACH BYPASS',sub:'Silver retention · High contrast · Desaturated',fn(r,g,b){
    const l=.299*r+.587*g+.114*b,lc=scv(l,.5,2.2),s=Math.max(0,1-l*3);
    return[r*.4+lc*.6,g*.4+lc*.6+s*.03,b*.4+lc*.6+s*.05];}},
  agfa:{name:'AGFA VISTA 200',sub:'Warm greens · Vintage fade',fn(r,g,b){
    let rn=scv(r*.9+.06,.52,1.1),gn=scv(g*.92+.04,.5,1.15),bn=scv(b*.85+.08,.5,1.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.82,a+(gn-a)*.88,a+(bn-a)*.75];}},
  cross:{name:'CROSS PROCESS',sub:'High saturation · Shifted hues',fn(r,g,b){
    let rn=scv(r,.4,2.5),gn=scv(g,.5,2.2),bn=scv(b,.6,2.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.8+.04,a+(gn-a)*1.5+.02,a+(bn-a)*1.6-.05];}},
  acros:{name:'B&W ACROS',sub:'High contrast · Optical channel mix',fn(r,g,b){
    let l=.35*r+.52*g+.13*b;l=scv(l,.5,2.0);
    if(l<.5)l*=.92;if(l>.85)l=.85+(l-.85)*.5;return[l,l,l];}},
  hp5:{name:'ILFORD HP5',sub:'Classic B&W · Wide latitude',fn(r,g,b){
    const l=scv(.299*r+.587*g+.114*b,.48,1.5);return[l,l,l];}},
  bw_soft:{name:'B&W SOFT',sub:'Low contrast · Airy · Faded blacks',fn(r,g,b){
    const l=scv(.22*r+.64*g+.14*b,.5,0.8)*.8+.10;return[l,l,l];}},
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

/* ── WebGL ── */
const VS=`attribute vec2 a_pos;varying vec2 v_uv;
void main(){v_uv=vec2(a_pos.x*.5+.5,.5-a_pos.y*.5);gl_Position=vec4(a_pos,0.,1.);}`;

const FS=`precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_vid_tex;uniform sampler2D u_lut_tex;
uniform float u_lut_sz;uniform vec2 u_cvs_sz;uniform vec2 u_vid_sz;
uniform float u_zoom;uniform float u_ev;uniform float u_vig;
uniform float u_grain;uniform float u_grain_sz;uniform float u_time;

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
  vec3 col=texture2D(u_vid_tex,vuv).rgb;
  col=clamp(col*u_ev,0.,1.);
  col=applyLUT(col);
  if(u_vig>0.){vec2 d=(v_uv-.5)*2.;float vig=smoothstep(.3,2.0,dot(d,d));col*=1.-u_vig*vig*.88;}
  if(u_grain>0.){float lum=dot(col,vec3(.299,.587,.114));vec2 nuv=v_uv*u_cvs_sz/(8./u_grain_sz)+vec2(u_time*.17,u_time*.13);col=clamp(col+(fbm(nuv)*2.-1.)*u_grain*.2*gc(lum),0.,1.);}
  gl_FragColor=vec4(col,1.);
}`;

const glCv=document.getElementById('gl-canvas');
let gl,prog,vtex,ltex;
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
  ['u_lut_sz','u_ev','u_vig','u_grain','u_grain_sz','u_time','u_zoom','u_cvs_sz','u_vid_sz'].forEach(n=>U[n]=gl.getUniformLocation(prog,n));
  vtex=mkT();ltex=mkT();
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
  const p=glCv.parentElement,bw=p.clientWidth|0,bh=p.clientHeight|0;
  if(glCv.width!==bw||glCv.height!==bh){glCv.width=bw;glCv.height=bh;gl.viewport(0,0,bw,bh);}
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);
  try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){return;}
  gl.uniform2f(U.u_cvs_sz,bw,bh);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
  gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.ev));
  gl.uniform1f(U.u_vig,S.vignette);gl.uniform1f(U.u_grain,S.grain);
  gl.uniform1f(U.u_grain_sz,S.grainSize);gl.uniform1f(U.u_time,performance.now()/1000);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

/* ── Dial ── */
const MODES={
  exposure:{min:-2,  max:2,  step:.05,hasCenter:true, fmt:v=>(v>=0?'+':'')+v.toFixed(1)+' EV'},
  zoom:    {min:1.0, max:4.0,step:.05,hasCenter:false,fmt:v=>v.toFixed(1)+'×'},
  grain:   {min:0,   max:1,  step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
  vignette:{min:0,   max:1,  step:.02,hasCenter:false,fmt:v=>Math.round(v*100)+'%'},
};
const TPX=13;
let ddrag=false,dlast=0,doff=0;

function nT(){const m=MODES[S.mode];return Math.round((m.max-m.min)/m.step);}
function getV(){return{exposure:S.ev,zoom:S.zoom,grain:S.grain,vignette:S.vignette}[S.mode];}
function setV(v){
  const m=MODES[S.mode];v=Math.max(m.min,Math.min(m.max,Math.round(v/m.step)*m.step));
  if(S.mode==='exposure')S.ev=v;else if(S.mode==='zoom')S.zoom=v;else if(S.mode==='grain')S.grain=v;else S.vignette=v;
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
}
function syncDial(){const v=getV(),o=v2o(v);doff=o;const el=document.getElementById('dial-ticks');if(el)el.style.transform=`translateX(${o}px)`;updHUD(v);}
function updHUD(v){const m=MODES[S.mode],f=m.fmt(v);document.getElementById('hud-mode-val').textContent=f;document.getElementById('hud-mode-name').textContent=S.mode.toUpperCase();if(S.mode==='exposure')document.getElementById('hud-ev').textContent=f;}
function dMove(dx){doff+=dx;const v=setV(o2v(doff));doff=v2o(v);const el=document.getElementById('dial-ticks');if(el)el.style.transform=`translateX(${doff}px)`;updHUD(v);}

const dialEl=document.getElementById('dial-wrap');
dialEl.addEventListener('pointerdown',e=>{ddrag=true;dlast=e.clientX;dialEl.setPointerCapture(e.pointerId);},{passive:true});
dialEl.addEventListener('pointermove',e=>{if(!ddrag)return;dMove(e.clientX-dlast);dlast=e.clientX;},{passive:true});
dialEl.addEventListener('pointerup',()=>ddrag=false);
dialEl.addEventListener('pointercancel',()=>ddrag=false);

/* ── Tap-to-focus ── */
document.getElementById('focus-overlay').addEventListener('pointerdown',async e=>{
  const r=e.currentTarget.getBoundingClientRect(),rx=(e.clientX-r.left)/r.width,ry=(e.clientY-r.top)/r.height;
  const ring=document.getElementById('focus-ring');
  ring.style.left=rx*100+'%';ring.style.top=ry*100+'%';ring.classList.remove('hidden');
  setTimeout(()=>ring.classList.add('hidden'),1300);
  if(!S.stream)return;
  const tk=S.stream.getVideoTracks()[0];if(!tk)return;
  try{await tk.applyConstraints({advanced:[{focusMode:'manual',pointsOfInterest:[{x:rx,y:ry}]}]});}
  catch(_){try{await tk.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(__){}}
  document.getElementById('hud-focus-label').textContent='MF';
  setTimeout(()=>document.getElementById('hud-focus-label').textContent='AF',2000);
});

/* ── Landscape warning ── */
function chkOrientation(){document.getElementById('rotate-overlay').classList.toggle('hidden',!window.matchMedia('(orientation:landscape)').matches);}
window.addEventListener('resize',chkOrientation);
window.matchMedia('(orientation:landscape)').addEventListener('change',chkOrientation);
chkOrientation();

/* ── Visibility: pause render when hidden ── */
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    cancelAnimationFrame(S.raf);S.raf=null;
  }else{
    if(S.ready&&S.raf===null)render();
  }
});

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

/* ─────────────────────────────────────
   CAPTURE
   Speed fix: use 1080px output (not 1920)
   Antik fix: draw photo THEN frame on top
───────────────────────────────────── */
function c255(v){return Math.max(0,Math.min(255,v+.5|0));}

// Fast CPU LUT — pre-clamp inputs to avoid index checks
function cpuLUT(r,g,b,ld){
  const{d,sz}=ld,sc2=sz-1;
  const rf=Math.min(r/255,1)*sc2,gf=Math.min(g/255,1)*sc2,bf=Math.min(b/255,1)*sc2;
  const r0=rf|0,r1=Math.min(r0+1,sc2),g0=gf|0,g1=Math.min(g0+1,sc2),b0=bf|0,b1=Math.min(b0+1,sc2);
  const dr=rf-r0,dg=gf-g0,db=bf-b0;
  const idx=(a,c,dd)=>(dd*sz*sz+c*sz+a)*3;
  return[0,1,2].map(ch=>{
    const v000=d[idx(r0,g0,b0)+ch],v100=d[idx(r1,g0,b0)+ch],v010=d[idx(r0,g1,b0)+ch],v110=d[idx(r1,g1,b0)+ch];
    const v001=d[idx(r0,g0,b1)+ch],v101=d[idx(r1,g0,b1)+ch],v011=d[idx(r0,g1,b1)+ch],v111=d[idx(r1,g1,b1)+ch];
    const c00=v000+(v100-v000)*dr,c10=v010+(v110-v010)*dr,c01=v001+(v101-v001)*dr,c11=v011+(v111-v011)*dr;
    return(c00+(c10-c00)*dg+(c01+(c11-c01)*dg-c00-(c10-c00)*dg)*db)*255;
  });
}

function showSaving(on){document.getElementById('saving-overlay').classList.toggle('hidden',!on);}
function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}

async function capture(){
  if(S.saving||!S.ready)return;
  S.saving=true;showSaving(true);
  await new Promise(r=>setTimeout(r,20));

  // Use 1080px output for speed
  const OUT=1080;

  const frame=document.getElementById('frame-sel').value;
  let cw=OUT,ch=OUT,photoX=0,photoY=0,photoS=OUT;

  if(frame==='antik'){
    // Frame has transparent inner — photo fills full canvas, frame composited on top
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

  // Background
  if(frame==='polaroid'){sCtx.fillStyle='#f2ede4';}
  else{sCtx.fillStyle='#000';}
  sCtx.fillRect(0,0,cw,ch);
  if(frame==='film')drawFilm(sCtx,cw,ch,Math.round(OUT*.13));

  // ── Read GPU-processed (grain+LUT) frame directly from WebGL canvas ──
  // Force one render draw to ensure buffer is populated (preserveDrawingBuffer:true)
  if(S.ready&&vid.readyState>=2){
    const p=glCv.parentElement,bw=glCv.width,bh=glCv.height;
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,vtex);
    try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,vid);}catch(e){}
    gl.uniform2f(U.u_cvs_sz,bw,bh);gl.uniform2f(U.u_vid_sz,S.vidW,S.vidH);
    gl.uniform1f(U.u_zoom,S.zoom);gl.uniform1f(U.u_ev,Math.pow(2,S.ev));
    gl.uniform1f(U.u_vig,S.vignette);gl.uniform1f(U.u_grain,S.grain);
    gl.uniform1f(U.u_grain_sz,S.grainSize);gl.uniform1f(U.u_time,performance.now()/1000);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  const glW=glCv.width,glH=glCv.height;
  const pixels=new Uint8Array(glW*glH*4);
  gl.readPixels(0,0,glW,glH,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  // WebGL Y-axis is flipped — mirror vertically before use
  const flipped=new Uint8Array(glW*glH*4);
  for(let row=0;row<glH;row++){
    const src=(glH-1-row)*glW*4,dst=row*glW*4;
    flipped.set(pixels.subarray(src,src+glW*4),dst);
  }
  // Crop the square region (matching shader cropUV) from the GL canvas
  const cAR=glW/glH,vAR=S.vidW/S.vidH;
  let scx=1,scy=1;
  if(vAR>cAR)scx=cAR/vAR;else scy=vAR/cAR;
  scx/=S.zoom;scy/=S.zoom;
  const cropX=Math.round(((1-scx)/2)*glW),cropY=Math.round(((1-scy)/2)*glH);
  const cropW=Math.round(scx*glW),cropH=Math.round(scy*glH);
  const tmp=document.createElement('canvas');tmp.width=photoS;tmp.height=photoS;
  const tc=tmp.getContext('2d',{willReadFrequently:true});
  const srcCanvas=document.createElement('canvas');srcCanvas.width=glW;srcCanvas.height=glH;
  const srcCtx=srcCanvas.getContext('2d');
  srcCtx.putImageData(new ImageData(new Uint8ClampedArray(flipped),glW,glH),0,0);
  tc.drawImage(srcCanvas,cropX,cropY,cropW,cropH,0,0,photoS,photoS);

  if(frame==='antik'){
    // sCtx already has black background from fillRect above.
    // Layer 1: photo fills entire canvas (covers black bg in inner area)
    sCtx.drawImage(tmp,0,0,OUT,OUT);
    // Layer 2: transparent-inner frame on top.
    //   Frame's inner area is transparent → photo shows through.
    //   Frame's ornament+border are opaque → they cover photo edges.
    try{
      const fimg=await loadImg('antik_keret_web.png');
      sCtx.drawImage(fimg,0,0,OUT,OUT);
    }catch(e){console.warn('Antik frame failed',e);}
    // No flatten needed — canvas already has opaque black base from fillRect,
    // photo and frame are drawn opaque on top. JPEG export is safe.
  } else {
    sCtx.drawImage(tmp,photoX,photoY,photoS,photoS);
  }

  // Date stamp
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

  // Polaroid signature
  if(frame==='polaroid'){
    const fs=Math.round(OUT*.026);
    sCtx.font=`${fs}px Courier New`;sCtx.textAlign='right';sCtx.fillStyle='#5a5040';
    sCtx.fillText('by Analogia',photoX+photoS-Math.round(OUT*.02),ch-Math.round((ch-photoY-photoS)/2+fs*.3));
  }

  // Show preview
  sv.toBlob(blob=>{
    const now=new Date(),p=n=>String(n).padStart(2,'0');
    const nm=(PROF[S.simKey]?.name||'CUSTOM').replace(/[ &]/g,'_');
    const fname=`Analogia_${nm}_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.jpg`;
    if(S.lastPhotoUrl)URL.revokeObjectURL(S.lastPhotoUrl);
    const url=URL.createObjectURL(blob);
    showSaving(false);
    const pi=document.getElementById('photo-preview-img');
    pi.onload=()=>{S.lastPhotoUrl=url;};
    pi.src=url;pi.setAttribute('data-filename',fname);
    document.getElementById('photo-overlay').classList.remove('hidden');
    S.saving=false;
  },'image/jpeg',.92);
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

/* ── Camera ── */
async function initCam(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1920}},audio:false});
    S.stream=stream;vid.srcObject=stream;
    vid.addEventListener('loadedmetadata',()=>{
      S.ready=true;
      const tk=stream.getVideoTracks()[0],st=tk.getSettings();
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

/* ── Events ── */
document.getElementById('perm-btn').addEventListener('click',initCam);
document.getElementById('shutter').addEventListener('click',capture);

document.querySelectorAll('.mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');S.mode=btn.dataset.mode;buildDial();syncDial();
  });
});

document.getElementById('photo-overlay-close').addEventListener('click',()=>{
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
    document.getElementById('photo-overlay').classList.add('hidden');
    img.src='';
    if(S.lastPhotoUrl){URL.revokeObjectURL(S.lastPhotoUrl);S.lastPhotoUrl=null;}
  },400);
});

/* ── Boot ── */
(async()=>{
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
  if(navigator.mediaDevices?.getUserMedia)initCam();
  else document.getElementById('perm-err').textContent='Kamera API nem támogatott.';
})();
