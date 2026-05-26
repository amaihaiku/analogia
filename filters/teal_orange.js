window.PD = window.PD || {};
window.PD.teal_orange = {
  name: 'TEAL & ORANGE',
  sub: 'Hollywood grade · Skin warmth · Teal shadows',
  fn: function(r, g, b) {
    function scv(x,p,c){const t=x-p;return t/Math.sqrt(1+(c*t)*(c*t))+p;}
    const l=.299*r+.587*g+.114*b,s=Math.max(0,1-l*2.5),h=Math.max(0,l*2-1),m=1-s-h;
    let rn=r-s*.18+h*.12+m*.04,gn=g+s*.06+h*.04,bn=b+s*.14-h*.16-m*.03;
    const a=(rn+gn+bn)/3;return[a+(rn-a)*1.3,a+(gn-a)*1.1,a+(bn-a)*1.25];
  }
};