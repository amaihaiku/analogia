window.PD = window.PD || {};
window.PD.cinestill = {
  name: 'CINESTILL 800T',
  sub: 'Tungsten · Halation · Cinematic blue',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    let rn=scv(r*.85,.5,1.4),gn=scv(g*.92,.5,1.3),bn=scv(b+.05,.5,1.25);
    const l=.299*rn+.587*gn+.114*bn,s=Math.max(0,1-l*2.8),h_orig=Math.max(0,l*3-2);
    let rout=rn+s*.04+h_orig*.08, gout=gn+s*.02-h_orig*.04, bout=bn+s*.10;
    if(l>0.85){
      const t=Math.max(0,Math.min(1,(l-0.85)/0.15));
      const h=t*t*(3-2*t);
      rout+=0.15*h;
      bout-=0.04*h;
    }
    rout+=Math.max(0,l-0.85)*1.2;
    bout-=Math.max(0,l-0.85)*0.4;
    return[rout,gout,bout];
  }
};