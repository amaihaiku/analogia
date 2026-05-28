window.PD = window.PD || {};
window.PD.wanderson = {
  name: 'WANDERSON',
  sub: 'Symmetrical pastel · Mustard yellows · Creamy ivory',
  fn: function(r, g, b) {
    // 1. Luminancia (fényerő) kiszámítása
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // 2. Alapvető meleg vintage tónusozás (Kodak Gold / Ektachrome hatás)
    // A pirosat és a zöldet finoman emeljük, a kéket visszahúzzuk a sárgás alapért
    let rn = r * 1.06 + 0.02;
    let gn = g * 1.03 + 0.01;
    let bn = b * 0.85 + 0.01;
    
    // 3. Krémes csúcsfények (Highlights) és lágy árnyékok elkülönítése
    // Kiszámoljuk a csúcsfények maszkját (ahol a fényerő 0.5 felett van)
    const high = Math.max(0, l * 2 - 1); 
    
    // A világos részeken még jobban elnyomjuk a kéket, és erősítjük a meleg tónust
    rn += high * 0.03;
    gn += high * 0.02;
    bn -= high * 0.06; // Ez adja meg a jellegzetes elefántcsont/krém fehér színt
    
    // 4. Szelektív szaturáció (A Wes Anderson-féle pasztell mag)
    const a = (rn + gn + bn) / 3;
    
    // A piros és zöld karakteres marad, de a kék szaturációját teljesen kioltjuk
    rn = a + (rn - a) * 1.15;
    gn = a + (gn - a) * 1.05;
    bn = a + (bn - a) * 0.60; // Erős desaturáció a kék csatornán a pasztell hatásért
    
    // 5. Biztonsági vágás (clamping), hogy az értékek 0.0 és 1.0 között maradjanak
    return [
      Math.min(1, Math.max(0, rn)),
      Math.min(1, Math.max(0, gn)),
      Math.min(1, Math.max(0, bn))
    ];
  }
};