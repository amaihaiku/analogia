window.PD = window.PD || {};
window.PD.fuji_velvia = {
  name: 'FUJI VELVIA 50',
  sub: 'Ultra saturated · Deep shadows · Vivid',
  fn: function(r, g, b) {
    // 1. Valódi kontraszt S-görbe (c > 1 növeli a kontrasztot, mélyíti az árnyékokat)
    function contrast(x, c) {
      return x < 0.5 ? 0.5 * Math.pow(2 * x, c) : 1 - 0.5 * Math.pow(2 * (1 - x), c);
    }

    // A Velvia híres a kemény kontrasztjáról és mikrokontrasztjáról ("bite")
    // A piros kapja a legnagyobb kontrasztot, a kék valamivel lágyabb marad
    let rn = contrast(r, 1.6);
    let gn = contrast(g, 1.5);
    let bn = contrast(b, 1.35);

    // Kiszámítjuk az átlagos fényerőt a szaturációhoz
    const a = (rn + gn + bn) / 3;

    // 2. Extrém szaturáció alkalmazása (a Velvia védjegye)
    // A zöldet magasan tartjuk a vibráló tájképi növényzetért, a pirosat a drámáért
    let r_sat = a + (rn - a) * 1.65;
    let g_sat = a + (gn - a) * 1.55;
    let b_sat = a + (bn - a) * 1.45;

    // 3. Ken Rockwell-féle "Pleasant Distortion" (Meleg színek még melegebbek lesznek)
    // Ha a pixel eleve meleg tónusú (több a piros, mint a kék), dinamikusan felerősítjük.
    // Ez gyönyörűen megizzasztja a naplementéket és a bőrtónusokat, de békén hagyja a kék eget.
    const warmth = Math.max(0, rn - bn) * 0.2;

    // 4. Végső színcsatornák és a [0, 1] tartományba kényszerítés (clamping)
    return [
      Math.min(1, Math.max(0, r_sat + warmth)),
      Math.min(1, Math.max(0, g_sat + warmth * 0.2)), // kis zöld a narancsos/arany fényekhez
      Math.min(1, Math.max(0, b_sat - warmth * 0.4))  // a meleg helyeken elnyomjuk a kéket
    ];
  }
};