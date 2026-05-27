window.PD = window.PD || {};
window.PD.highcontrast_bw = {
  name: 'HIGH CONTRAST',
  sub: 'Crushed blacks · Clean whites · Graphic',
  isBW: true, // HOZZÁADVA a monokróm szivárgás vezérléséhez
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let l=0.25*r+0.65*g+0.10*b;
    l=scv(l,0.42,3.5);
    if(l<0.25)l*=0.6;
    if(l>0.75)l=0.75+(l-0.75)*1.3;
    return[l,l,l];
  }
};