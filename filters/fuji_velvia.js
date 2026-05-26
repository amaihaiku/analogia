window.PD = window.PD || {};
window.PD.fuji_velvia = {
  name: 'FUJI VELVIA 50',
  sub: 'Ultra saturated · Deep shadows · Vivid',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let rn=scv(r,.5,2.2),gn=scv(g,.5,2.0),bn=scv(b,.5,1.9);
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.5+.02,a+(gn-a)*1.45,a+(bn-a)*1.4-.02];
  }
};