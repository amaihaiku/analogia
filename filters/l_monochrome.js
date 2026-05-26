window.PD = window.PD || {};
window.PD.l_monochrome = {
  name: 'L-MONOCHROME',
  sub: 'Leica rendering · Rich midtones · Airy',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let l=0.30*r+0.59*g+0.11*b;
    l=scv(l,0.50,1.1);
    const t=1-Math.abs(l-0.5)*2;l+=t*0.04;
    if(l<0.3)l=l*0.88+0.035;
    if(l>0.88)l=0.88+(l-0.88)*0.4;
    return[l,l,l];
  }
};