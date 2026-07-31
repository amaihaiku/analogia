/** 
 * capture.js 
 * Mechanikus zár, WebGL pillanatkép mentése, 2D kompozitálás (keretek/dátum) és fájlgenerálás.
 */
import { S, Store, Elements, PREVIEW_RES, CAPTURE_RES, SAVE_RES, PROF } from './state.js';
import { gl, U, snapTex, detex, updateCanvasDimensions, markUniformsDirty } from './webgl.js';
import { torchOff, torchArmed, setStreamResolution, waitForVideoFrames } from './camera.js';
import { dlog, loadImg } from './utils.js';
// ui.js importok a felület frissítéséhez:
import { getSelectedFrame, updateFocusLabel } from './ui.js';

// Mentés-jelző overlay
export function setSavingIndicator(on) {
  const el = document.getElementById('saving-overlay');
  if (el) el.classList.toggle('hidden', !on);
}

// Mechanikus zár animáció és időzítés
export function triggerMechanicalShutter(callback) {
  const blink = document.getElementById('shutter-blink');
  if (!blink) { callback(); return; }
  
  blink.classList.remove('hidden', 'open');
  blink.getBoundingClientRect(); // Reflow kényszerítése
  blink.classList.add('active'); 
  
  setTimeout(async () => {
    try { await callback(); } catch (_) {}
    blink.classList.add('open');
    blink.classList.remove('active');
    setTimeout(() => {
      blink.classList.add('hidden');
      blink.classList.remove('open');
    }, 160);
  }, 120);
}

// Biztonságos szál-átengedés a böngésző UI frissítéséhez (a régi dupla rAF helyett)
function yieldThread() {
  return new Promise(r => setTimeout(r, 40));
}

// Fő képkészítő függvény
export async function capture() {
  if (S.saving || !S.ready) return;
  if (!(Elements.vid && Elements.vid.readyState >= 2)) return;
  
  S.saving = true;
  setSavingIndicator(true);
  dlog('EXPO indul. flashEnabled=' + Store.flashEnabled);

  if (Store.flashEnabled && torchArmed) {
    await waitForVideoFrames(5, 400);
  }

  // Dupla expozíció - 1. szakasz
  if (S.deActive && S.deStage === 0) {
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, detex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Elements.vid); } catch(e){}
    torchOff();
    setStreamResolution(PREVIEW_RES, false);
    
    triggerMechanicalShutter(() => {
      S.deStage = 1;
      updateFocusLabel('DE 2/2');
      const sh = document.getElementById('shutter');
      if (sh) sh.classList.add('de-primed');
      setSavingIndicator(false);
      S.saving = false;
    });
    return; 
  }

  const snapW = Elements.vid.videoWidth || S.vidW;
  const snapH = Elements.vid.videoHeight || S.vidH;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, snapTex);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Elements.vid); } catch(e){}
  torchOff();

  triggerMechanicalShutter(async () => {
    // Esélyt adunk a DOM-nak, hogy kirajzolja a spinnert a blokkoló kód előtt
    await yieldThread();

    if (window.FX && window.FX.active) { window.FX.seed = Math.random(); }
    
    const frameW = snapW;
    const frameH = snapH;
    const targetAspect = S.aspectRatio === '3:2' ? 3 / 2 : 1;
    const srcShort = Math.min(frameW, frameH) || PREVIEW_RES;
    const maxSave = SAVE_RES > 0 ? Math.min(SAVE_RES, srcShort) : srcShort;
    const baseSize = Math.max(PREVIEW_RES, maxSave);
    let outW = baseSize;
    let outH = baseSize;
    let frame = getSelectedFrame();

    if (S.aspectRatio === '3:2') {
      frame = 'none';
      if (frameW / frameH >= targetAspect) {
        outH = frameH;
        outW = Math.round(frameH * targetAspect);
      } else {
        outW = frameW;
        outH = Math.round(frameW / targetAspect);
      }
    }

    let cw = outW, ch = outH, photoX = 0, photoY = 0, photoS = outW;

    if (frame === 'polaroid') {
      const pad = Math.round(outW * .06), bot = Math.round(outW * .22);
      cw = outW + pad * 2; 
      ch = outW + pad + bot; 
      photoX = pad; 
      photoY = pad; 
      photoS = outW;
    }

    const sv = document.getElementById('save-canvas');
    if (!sv) { S.saving = false; setSavingIndicator(false); return; }
    sv.width = cw; 
    sv.height = ch;
    const sCtx = sv.getContext('2d');

    if (frame === 'polaroid') { sCtx.fillStyle = '#f2ede4'; } else { sCtx.fillStyle = '#000'; }
    sCtx.fillRect(0, 0, cw, ch);

    if (S.ready && Elements.vid && Elements.vid.readyState >= 2) {
      Elements.glCv.width = outW; Elements.glCv.height = outH;
      gl.viewport(0, 0, outW, outH);

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, snapTex);
      gl.uniform2f(U.u_cvs_sz, outW, outH);
      gl.uniform2f(U.u_vid_sz, frameW, frameH);
      gl.uniform1f(U.u_zoom, S.zoom);
      gl.uniform1f(U.u_ev, Math.pow(2, S.exposure));
      gl.uniform1f(U.u_vig, S.vignette);
      gl.uniform1f(U.u_shadows, S.shadows);
      gl.uniform1f(U.u_highlights, S.highlights);
      gl.uniform1f(U.u_tone, S.tone);

      const grainScale = outW / Math.max(1, Math.min(Store.cachedCanvasW, Store.cachedCanvasH));
      gl.uniform1f(U.uGrainIntensity, S.grain * 0.2);
      gl.uniform1f(U.uGrainSize, (1.0 + S.grain * 2.5) * grainScale);
      gl.uniform1f(U.uTime, performance.now() / 1000.0);
      gl.uniform1f(U.uIsBW, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);

      if (S.deActive && S.deStage === 1) {
        gl.uniform1f(U.u_de_active, 1.0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, detex);
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
      }

      gl.uniform1f(U.u_fx_bw, (PROF[S.simKey] && PROF[S.simKey].isBW) ? 1.0 : 0.0);
      gl.uniform1f(U.u_fx_quality, 1.0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      markUniformsDirty();
    }
    
    if (!Store.memoTmpCanvas) { Store.memoTmpCanvas = document.createElement('canvas'); }
    if (!Store.memoSrcCanvas) { Store.memoSrcCanvas = document.createElement('canvas'); }
    
    Store.memoTmpCanvas.width = cw; Store.memoTmpCanvas.height = ch;
    Store.memoSrcCanvas.width = outW; Store.memoSrcCanvas.height = outH;
    
    const tc = Store.memoTmpCanvas.getContext('2d');
    const srcCtx = Store.memoSrcCanvas.getContext('2d');
    
    const pixels = new Uint8Array(outW * outH * 4);
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    updateCanvasDimensions();
    setStreamResolution(PREVIEW_RES, false);

    await yieldThread();

    srcCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer), outW, outH), 0, 0);

    tc.save();
    tc.translate(0, ch);
    tc.scale(1, -1);
    tc.drawImage(Store.memoSrcCanvas, 0, 0, outW, outH, 0, 0, cw, ch);
    tc.restore();

    if (frame === 'polaroid') {
      sCtx.drawImage(Store.memoTmpCanvas, photoX, photoY, photoS, photoS);
    } else {
      sCtx.drawImage(Store.memoTmpCanvas, 0, 0, cw, ch);
    }

    if (frame === 'antik') {
      try {
        const fimg = await loadImg('antik_keret_web.png');
        sCtx.drawImage(fimg, 0, 0, OUT, OUT);
      } catch(e){}
    } else if (frame === 'film') {
      drawFilm(sCtx, cw, ch, Math.round(OUT * .13));
    }

    const dateTog = document.getElementById('date-tog');
    if (dateTog && dateTog.checked) {
      const now = new Date(), p = n => String(n).padStart(2, '0');
      const fs = Math.max(14, photoS * .036 | 0);
      const ds = `${p(now.getMonth() + 1)} ${p(now.getDate())} '${String(now.getFullYear()).slice(-2)}`;
      sCtx.font = `bold ${fs}px Courier New`; 
      sCtx.textAlign = 'right';
      
      let tx = photoX + photoS - fs * 0.5;
      let ty = photoY + photoS - fs * 0.4;
      if (frame === 'film') {
        ty = photoY + photoS - Math.round(OUT * 0.13) - fs * 0.4;
      }
      
      sCtx.fillStyle = 'rgba(0,0,0,0.6)';
      sCtx.fillText(ds, tx + 2, ty + 2);
      sCtx.fillStyle = '#e8830a';
      sCtx.fillText(ds, tx, ty);
    }

    if (frame === 'polaroid') {
      const fs = Math.round(OUT * .026);
      sCtx.font = `${fs}px Courier New`; sCtx.textAlign = 'right'; sCtx.fillStyle = '#5a5040';
      sCtx.fillText('by Analogia', photoX + photoS - Math.round(OUT * .02), ch - Math.round((ch - photoY - photoS) / 2 + fs * .3));
    }

    sv.toBlob(blob => {
      const now = new Date(), p = n => String(n).padStart(2, '0');
      const nm = (PROF[S.simKey]?.name || 'CUSTOM').replace(/[ &]/g, '_');
      const fname = `Analogia_${nm}_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.jpg`;
      
      if (Store.activeBlobUrl) URL.revokeObjectURL(Store.activeBlobUrl);
      const url = URL.createObjectURL(blob);
      S.lastPhotoUrl = url;
      Store.activeBlobUrl = url;
      Store.activeFilename = fname;
      
      const previewImg = document.getElementById('photo-preview-img');
      const photoOverlay = document.getElementById('photo-overlay');
      setSavingIndicator(false);
      
      if (previewImg && photoOverlay) {
        previewImg.src = url;
        previewImg.alt = fname;
        previewImg.setAttribute('data-filename', fname);
        photoOverlay.classList.remove('hidden');
      }
      
      if (S.deActive) {
        S.deStage = 0;
        const sh = document.getElementById('shutter'); if(sh) sh.classList.remove('de-primed');
        updateFocusLabel('AF');
      }
      
      S.saving = false;
      updateCanvasDimensions();
    }, 'image/jpeg', .92);
  });
}

function drawFilm(c, W, H, sh) {
  [0, H - sh].forEach(sy => {
    c.fillStyle = '#1e1c17';
    c.fillRect(0, sy, W, sh);
    const hh = Math.round(sh * 0.55), hy = sy + (sh - hh) / 2;
    const steps = 5;
    const colWidth = W / steps;
    const hw = Math.round(colWidth * 0.35); 
    c.fillStyle = '#0a0904';
    for (let i = 0; i < steps; i++) {
      const x = Math.round((colWidth * i) + (colWidth - hw) / 2);
      c.beginPath();
      c.rect(x, hy, hw, hh);
      c.fill();
    }
  });
}