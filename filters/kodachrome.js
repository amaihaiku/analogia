/* ═══════════════════════════════════════════════════════════════
   ANALOGIA — filters/kodachrome.js   ·   v2 (calibrated)
   Modular structural injection logic.

   Kodachrome 64 emuláció, hűségre kalibrálva:
     • Mély, TISZTA feketék (lehorgonyzott végpontok)
     • Cyan-hajlású árnyékok (a film védjegye)
     • Meleg, telített, PIROS-domináns középtónus
     • Visszafogott, kissé hűvös zöldek
     • Tiszta csúcsfények (lágy roll-off, nincs kemény klippelés)

   A színkarakter a KÖZÉPTÓNUSban a legerősebb; a fények
   megőrzik a semlegességüket — pont mint a valódi dián.
═══════════════════════════════════════════════════════════════ */
window.PD = window.PD || {};

window.PD.kodachrome = {
  name: 'KODACHROME 64',
  sub: 'Rich contrast · Warm reds · Cyan shadows',
  fn: function (r, g, b) {

    // ── segédfüggvények ──
    function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
    function smoothstep(e0, e1, x) {
      var t = clamp01((x - e0) / (e1 - e0));
      return t * t * (3 - 2 * t);
    }
    // Pivotos S-görbe, 0..1-re ÚJRASKÁLÁZVA, hogy f(0)=0 és f(1)=1.
    // Ez adja a kontrasztot a fekete-/fehérpont elmozdítása nélkül.
    function scurve(x, p, c) {
      function f(t) { var u = t - p; return u / Math.sqrt(1 + (c * u) * (c * u)) + p; }
      var f0 = f(0), f1 = f(1);
      return (f(x) - f0) / (f1 - f0);
    }
    // Lágy highlight roll-off: a fények telítését komprimálja
    // kemény vágás helyett -> nem égnek ki, nem fordulnak színbe.
    function rolloff(x) {
      var k = 0.85;
      if (x <= k) return x;
      var range = 1 - k;
      return k + range * (1 - Math.exp(-(x - k) / range));
    }

    // ── 1) aszimmetrikus csatornakontraszt (a piros a legmeredekebb) ──
    var rn = scurve(r, 0.50, 1.55);
    var gn = scurve(g, 0.50, 1.45);
    var bn = scurve(b, 0.50, 1.40);

    // ── 2) tónus-maszkok (sima, éles törés nélkül) ──
    var l = 0.299 * rn + 0.587 * gn + 0.114 * bn;
    // árnyéksáv: a legmélyebb feketét NEM fogja meg (tiszta marad),
    // a mély-közép árnyékokat viszont cyan felé húzza.
    var shadow = smoothstep(0.04, 0.40, l) * (1 - smoothstep(0.40, 0.62, l));
    var high   = smoothstep(0.58, 1.00, l);
    var mid    = 1 - high;

    // ── 3) Kodachrome színkarakter ──
    rn += 0.050 * mid - 0.030 * shadow;   // meleg közép, hűvösebb árnyék
    gn += -0.015 * mid - 0.012 * shadow;  // visszafogott zöld
    bn += 0.045 * shadow - 0.015 * high;  // cyan árnyék, tisztább fény

    // ── 4) luminancia-függő telítettség ──
    //   erős a középtónusban, visszafogott a fényben,
    //   a legmélyebb árnyékban kifut -> semleges fekete.
    var a = 0.299 * rn + 0.587 * gn + 0.114 * bn;
    var satFloor = smoothstep(0.0, 0.10, l);
    var sat = (1.04 + 0.24 * mid) * satFloor + (1 - satFloor) * 1.0;
    rn = a + (rn - a) * sat;
    gn = a + (gn - a) * sat * 0.92;       // zöld kissé kevésbé telít
    bn = a + (bn - a) * sat * 1.02;

    // ── 5) roll-off + clamp ──
    return [clamp01(rolloff(rn)), clamp01(rolloff(gn)), clamp01(rolloff(bn))];
  }
};
