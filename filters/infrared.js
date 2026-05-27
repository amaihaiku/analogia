window.PD = window.PD || {};
window.PD.infrared = {
  name: 'INFRARED',
  sub: 'Green becomes white · Sky darkens · Dramatic',
  isBW: true, // HOZZÁADVA a monokróm szivárgás vezérléséhez
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let l=0.05*r+0.88*g+0.07*b;
    l=scv(l,0.45,2.2);
    l-=b*0.08;
    l=Math.max(0,Math.min(1,l));
    let rout=l+Math.max(0,l-0.7)*0.12;
    let gout=l+Math.max(0,l-0.7)*0.04;
    let bout=l-Math.max(0,l-0.7)*0.08;
    return[rout,gout,bout];
  }
};