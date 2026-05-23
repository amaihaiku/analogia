ANALOGIA RF-1 — LUT mappa
===========================

Ide helyezd a .cube fájlokat. A webapp automatikusan megpróbálja betölteni ezeket:
  kodachrome64.cube
  fuji_superia.cube
  fuji_velvia.cube
  kodak_portra.cube
  ilford_hp5.cube
  cinestill_800t.cube
  vintage_fade.cube
  teal_orange.cube

Saját LUT-ot is betölthetsz a Film Szimuláció ablakból.
A webapp localhost-on fut (python3 -m http.server) és csak akkor tölti
be automatikusan a /luts/ mappából, ha a fájlnév egyezik a fentiek valamelyikével.
