window.PD = window.PD || {};
window.PD.kodak_portra = {
  name: 'KODAK PORTRA 400',
  sub: 'Natural skin · Pastel palette',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let rn=scv(r,.48,1.2),gn=scv(g,.5,1.15),bn=scv(b,.52,1.1);
    const l=.299*rn+.587*gn+.114*bn;rn+=l*.05;gn+=l*.02;bn-=l*.02;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*.85,a+(gn-a)*.88,a+(bn-a)*.82];
  }
};