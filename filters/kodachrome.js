/* ═══════════════════════════════════════
   ANALOGIA — filters/kodachrome.js
   Modular structural injection logic.
═══════════════════════════════════════ */
window.PD = window.PD || {};

window.PD.kodachrome = {
  name: 'KODACHROME 64',
  sub: 'Rich contrast · Warm reds · Cyan shadows',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let rn = scv(r, .55, 1.6), gn = scv(g, .5, 1.5), bn = scv(b, .48, 1.45);
    const l = .299 * rn + .587 * gn + .114 * bn, s = Math.max(0, 1 - l * 2.5);
    rn += l * .08; gn -= l * .02; bn += s * .07 - l * .04; gn -= s * .04;
    const a = (rn + gn + bn) / 3;
    return [a + (rn - a) * 1.25, a + (gn - a) * 1.1, a + (bn - a) * 1.15];
  }
};