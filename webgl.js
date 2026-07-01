/** 
 * webgl.js 
 * WebGL motor, shaderek inicializálása, videó renderelése és LUT alkalmazása.
 */
import { S, Store, Elements, PROF } from './state.js';

export let gl, prog, vtex, ltex, detex, snapTex;
export const U = {};

// Shader forráskódok
const VS = `attribute vec2 a_pos;varying vec2 v_uv;
void main(){v_uv=vec2(a_pos.x*.5+.5,.5-a_pos.y*.5);gl_Position=vec4(a_pos,0.,1.);}`;

const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
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

float soft_knee1(float x){
  const float KNEE = 0.7;
  if (x <= KNEE) return x;
  float over = x - KNEE;
  float room = 1.0 - KNEE;
  return KNEE + room * (over / (over + room));
}
vec3 soft_knee(vec3 c){ return vec3(soft_knee1(c.r), soft_knee1(c.g), soft_knee1(c.b)); }

${window.FX && window.FX.shader ? window.FX.shader.helpers : ''}

void main(){
  vec2 vuv = cropUV(v_uv);
  vuv = clamp(vuv, 0.0, 1.0); 
  
  vec3 srgbIn = texture2D(u_vid_tex,vuv).rgb;
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
  
  float highlightMask = smoothstep(0.15, 0.9, linLum);
  float hlFactor = 1.0 + u_highlights * 0.6;
  vec3 invc = max(1.0 - clamp(linear, 0.0, 1.0), 0.00001);
  vec3 hlAdj = 1.0 - pow(invc, vec3(hlFactor));
  linear = mix(linear, hlAdj, highlightMask);
  
  vec3 srgbProcessed = pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
  vec3 col = applyLUT(srgbProcessed);
  
  col.r+=u_tone*0.12;
  col.g+=u_tone*0.04;
  col.b-=u_tone*0.15;
  col=clamp(col,0.0,1.0);
  
  vec2 vuv_saved=vuv; vuv=v_uv;
  ${window.FX && window.FX.shader ? window.FX.shader.calculation : ''}
  vuv=vuv_saved;
  
  if(abs(u_vig)>0.001){
    vec2 d=(v_uv-.5)*2.;
    float vig=smoothstep(.3,2.0,dot(d,d));
    if(u_vig>0.){
      col*=1.-u_vig*vig*.88;
    } else {
      col=mix(col,vec3(1.),min(1.,-u_vig*vig*.5));
    }
  }
  
  if(uGrainIntensity>0.0){
    float lum=dot(col,vec3(0.2126,0.7152,0.0722));
    float midtoneMask=4.0*lum*(1.0-lum);
    float t24=floor(uTime*24.0)/24.0;
    vec2 px=(v_uv*u_cvs_sz)/uGrainSize;
    if(uIsBW>0.5){
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

export function markUniformsDirty() { /* no-op */ }

export function updateCanvasDimensions() {
  if (!Elements.glCv || !Elements.glCv.parentElement) return;
  const p = Elements.glCv.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const heavyEffect = (window.FX && window.FX.active) || (S.grain > 0);
  const fxScale = heavyEffect ? 0.5 : 1.0;
  
  Store.cachedCanvasW = Math.round(p.clientWidth * dpr * fxScale);
  Store.cachedCanvasH = Math.round(p.clientHeight * dpr * fxScale);
  
  if (Elements.glCv.width !== Store.cachedCanvasW || Elements.glCv.height !== Store.cachedCanvasH) {
    Elements.glCv.width = Store.cachedCanvasW;
    Elements.glCv.height = Store.cachedCanvasH;
    if (gl) gl.viewport(0, 0, Store.cachedCanvasW, Store.cachedCanvasH);
    markUniformsDirty();
  }
}

export function initGL() {
  if (!Elements.glCv) return false;
  
  // Töröljük a régi textúrákat, ha újra inicializáljuk (pl. context restore után),
  // ezzel megelőzzük a GPU memóriaszivárgást.
  if (gl && vtex) {
    [vtex, ltex, detex, snapTex].forEach(t => { if(t) gl.deleteTexture(t); });
  }

  gl = Elements.glCv.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl) return false;
  
  const vs = mkS(gl.VERTEX_SHADER, VS);
  const fs = mkS(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return false;
  
  prog = gl.createProgram();
  gl.attachShader(prog, vs); 
  gl.attachShader(prog, fs); 
  gl.linkProgram(prog);
  
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // JAVÍTVA: getShaderInfoLog(s) helyett getProgramInfoLog(prog)
    console.error('Program linkelési hiba:', gl.getProgramInfoLog(prog));
    return null;
  }
  
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  
  const al = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(al);
  gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
  
  gl.uniform1i(gl.getUniformLocation(prog, 'u_vid_tex'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_lut_tex'), 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'u_de_tex'), 2);
  
  ['u_lut_sz', 'u_ev', 'u_vig', 'u_zoom', 'u_cvs_sz', 'u_vid_sz', 'u_shadows', 'u_highlights', 'u_tone', 'u_de_active',
   'uGrainIntensity', 'uGrainSize', 'uTime', 'uIsBW',
   'u_fx_active', 'u_fx_intensity', 'u_fx_scale', 'u_fx_stretch', 'u_fx_angle', 'u_fx_overexposure', 'u_fx_hue', 'u_fx_position', 'u_fx_seed', 'u_fx_bw', 'u_fx_quality'
  ].forEach(n => U[n] = gl.getUniformLocation(prog, n));
  
  vtex = mkT(); ltex = mkT(); detex = mkT(); snapTex = mkT();
  
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, detex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  updateCanvasDimensions();
  return true;
}

function mkS(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader fordítási hiba:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function mkT() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

export function uploadLUT(ld) {
  if (!ld || !gl) return;
  const { d, sz } = ld, W = sz * sz, rgba = new Uint8Array(W * sz * 4);
  for (let bi = 0; bi < sz; bi++) {
    for (let gi = 0; gi < sz; gi++) {
      for (let ri = 0; ri < sz; ri++) {
        const li = (bi * sz * sz + gi * sz + ri) * 3, ti = (gi * W + bi * sz + ri) * 4;
        rgba[ti] = d[li] * 255 + .5 | 0;
        rgba[ti + 1] = d[li + 1] * 255 + .5 | 0;
        rgba[ti + 2] = d[li + 2] * 255 + .5 | 0;
        rgba[ti + 3] = 255;
      }
    }
  }
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, ltex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, sz, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.uniform1f(U.u_lut_sz, sz);
}

export function render() {
  S.raf = requestAnimationFrame(render);
  if (S.frozen) return;
  drawFrame();
}

function drawFrame() {
  if (!S.ready || !Elements.vid || Elements.vid.readyState < 2) return;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, vtex);

  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Elements.vid); } catch(e) { return; }

  gl.uniform2f(U.u_cvs_sz, Store.cachedCanvasW, Store.cachedCanvasH); 
  gl.uniform2f(U.u_vid_sz, S.vidW, S.vidH);
  gl.uniform1f(U.u_zoom, S.zoom); 
  gl.uniform1f(U.u_ev, Math.pow(2, S.exposure));
  gl.uniform1f(U.u_vig, S.vignette);
  gl.uniform1f(U.u_shadows, S.shadows); 
  gl.uniform1f(U.u_highlights, S.highlights); 
  gl.uniform1f(U.u_tone, S.tone);

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

  if (window.FX) {
    gl.uniform1f(U.u_fx_active, window.FX.active ? 1.0 : 0.0);
    gl.uniform1f(U.u_fx_intensity, window.FX.intensity);
    gl.uniform1f(U.u_fx_scale, window.FX.scale);
    gl.uniform1f(U.u_fx_stretch, window.FX.stretch);
    gl.uniform1f(U.u_fx_angle, window.FX.angle);
    gl.uniform1f(U.u_fx_overexposure, window.FX.overexposure);
    gl.uniform1f(U.u_fx_hue, window.FX.hue);
    gl.uniform2f(U.u_fx_position, window.FX.position[0], window.FX.position[1]);
    gl.uniform1f(U.u_fx_seed, window.FX.seed);
  } else {
    gl.uniform1f(U.u_fx_active, 0.0);
  }
  
  gl.uniform1f(U.u_fx_bw, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);
  gl.uniform1f(U.u_fx_quality, 0.0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}