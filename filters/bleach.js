window.PD = window.PD || {};
window.PD.bleach = {
  name: 'BLEACH BYPASS',
  sub: 'Silver retention · High contrast · Desaturated',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    const l=.299*r+.587*g+.114*b,lc=scv(l,.5,2.2),s=Math.max(0,1-l*3);
    return[r*.4+lc*.6,g*.4+lc*.6+s*.03,b*.4+lc*.6+s*.05];
  }
};