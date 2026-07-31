/** 
 * state.js 
 * Globális állapotok, konfigurációk és DOM referenciák.
 */

// Szimulációs profilok (LUT-ok és beállítások)
export const PROF = {};

// A fő alkalmazás-állapot objektum
export const S = {
  stream: null, 
  raf: null, 
  ready: false, 
  saving: false,
  frozen: false, // élőkép befagyasztva (felbontásváltás kritikus szakasza alatt)
  focusLock: null, // {x,y} videó-koordinátában: ide zárt AE/AF, amíg máshová nem koppintanak
  aeBias: 0, // szoftveres fénymérés-zár: digitális EV-korrekció a koppintott pontra
  lockedFocusDistance: null, // betonozott manuális fókusztávolság (zár alatt)
  simKey: 'kodachrome',
  exposure: 0, shadows: 0, highlights: 0, tone: 0, grain: 0, grainSize: 2, vignette: 0,
  zoom: 1.0,
  mode: 'exposure',
  aspectRatio: '1:1',
  vidW: 1, vidH: 1,
  lastPhotoUrl: null,
  deActive: false,    
  deStage: 0,    
  focusDist: 0.5 
};

// Globális változók becsomagolva egy Store objektumba, 
// hogy az ES6 modulok könnyen mutálhassák őket.
export const Store = {
  videoDevices: [],
  currentDeviceIndex: 0,
  deferredPrompt: null,
  activeBlobUrl: null,
  activeFilename: "",
  flashEnabled: false,
  onVidMeta: null,
  cachedCanvasW: 0,
  cachedCanvasH: 0,
  memoTmpCanvas: null,
  memoSrcCanvas: null,
  DIAG: /[?&]debug=1/.test(location.search),
  diagBuf: [],
  diagEl: null
};

// Felbontás konstansok
export const PREVIEW_RES = 860;  // [720 gyenge kép] [1440 szaggat] [860 jó kompromisszum]
export const CAPTURE_RES = 0; // 0 = kérjük a kamerától a natív legjobb lehetséges felbontást
export const SAVE_RES = 0; // 0 = engedélyezzük a kamera teljes elérhető mentési méretét

// Gyakran használt alap DOM elemek
// (Feltételezzük, hogy az ES6 modulok `defer` attribútummal töltődnek be,
// így a DOM már létezik, amikor ez a fájl lefut).
export const Elements = {
  vid: document.getElementById('vid'),
  glCv: document.getElementById('gl-canvas')
};