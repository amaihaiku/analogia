/** 
 * filters.js 
 * Színprofilok, 3D LUT (.cube) értelmezés és procedurális szűrők betöltése.
 */
import { PROF } from './state.js';
import { cl } from './utils.js';

// Procedurális filterek (JS) "bepörzsölése" 3D LUT textúrává
export function bake(fn) {
  const N = 33, lut = new Float32Array(N * N * N * 3);
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        const [ro, go, bo] = fn(ri / (N - 1), gi / (N - 1), bi / (N - 1));
        const i = (bi * N * N + gi * N + ri) * 3;
        lut[i] = cl(ro);
        lut[i + 1] = cl(go);
        lut[i + 2] = cl(bo);
      }
    }
  }
  return { d: lut, sz: N };
}

// 3D LUT (.cube) Fájl Értelmező
export function parseCube(text) {
  const lines = text.split('\n');
  let size = 0;
  const data = [];
  
  for (let i = 0; i < lines.length; i++) {
    // Biztonságos trim, hogy a split(/\s+/) ne adjon üres stringeket sor eleji szóközöknél
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

// Külső filterek aszinkron, de determinisztikus betöltése
export async function loadExternalFilters() {
  let filters = [];
  try {
    const res = await fetch('filters/index.json');
    filters = await res.json();
  } catch(e) {
    console.warn('filters/index.json nem tölthető be:', e);
    return;
  }

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

  // Determinisztikus sorrend az index.json alapján (a race-condition elkerülése végett)
  for (const f of filters) {
    const id = typeof f === 'string' ? f : f.id;
    if (loaded[id]) PROF[id] = loaded[id];
  }
}