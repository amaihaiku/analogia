window.PD = window.PD || {};
window.PD.cross = {
  name: 'CROSS PROCESS',
  sub: 'High saturation · Shifted hues',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let rn=scv(r,.4,2.5),gn=scv(g,.5,2.2),bn=scv(b,.6,2.0);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.8+.04,a+(gn-a)*1.5+.02,a+(bn-a)*1.6-.05];
  }
};