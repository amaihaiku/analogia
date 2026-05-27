'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — fx.js v1.0 (PERFORMANCE OPTIMIZED)
═══════════════════════════════════════ */

window.FX = {
  active: false,
  intensity: 0.8,
  scale: 0.5,
  stretch: 3.0,
  angle: 0.15,
  overexposure: 0.6,
  hue: 0.8,         
  position: [0.0, 0.5],
  speed: 1.0,       
  seed: 0.0,
  lastTime: 0,

  randomize() {
    if (!this.active) return; 
    
    this.intensity = Math.random() * (1.1 - 0.3) + 0.3;     
    this.scale = Math.random() * (1.0 - 0.1) + 0.1;         
    this.stretch = Math.random() * (6.0 - 0.5) + 0.5;       
    this.angle = Math.random() * (0.8 - (-0.8)) + (-0.8);   
    this.overexposure = Math.random() * (1.0 - 0.0) + 0.0;  
    this.hue = Math.random() * (1.5 - 0.5) + 0.5;           
    
    this.position = [
      Math.random() * (1.5 - (-0.5)) + (-0.5),
      Math.random() * (1.5 - (-0.5)) + (-0.5)
    ];
    
    this.seed = Math.random();
  },

  shader: {
    helpers: `
      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
      float snoise(vec2 v){
          const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                   -0.577350269189626, 0.024390243902439);
          vec2 i  = floor(v + dot(v, C.yy) );
          vec2 x0 = v -   i + dot(i, C.xx) ;
          vec2 i1;
          i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i  = mod(i, 289.0);
          vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
          + i.x + vec3(0.0, i1.x, 1.0 ));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
            dot(x12.zw,x12.zw)), 0.0);
          m = m*m ;
          m = m*m ;
          vec3 x = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x) - 0.5;
          vec3 a0 = x - floor(x + 0.5);
          vec3 g = a0 * vec3(x0.x, x12.x, x12.z) + h * vec3(x0.y, x12.y, x12.w);
          vec3 rgb = 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
          m *= rgb;
          return 130.0 * dot(m, g);
      }
      float fx_fbm(vec2 uv) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 4; i++) {
              value += amplitude * snoise(uv * frequency);
              frequency *= 2.0;
              amplitude *= 0.5;
          }
          return value;
      }
      vec2 rotate2D(vec2 uv, float angle, vec2 pivot) {
          vec2 shifted = uv - pivot;
          float s = sin(angle);
          float c = cos(angle);
          vec2 rotated = vec2(
              shifted.x * c - shifted.y * s,
              shifted.x * s + shifted.y * c
          );
          return rotated + pivot;
      }
    `,

    calculation: `
      if (u_fx_active > 0.5) {
        // JAVÍTVA: Előre kiszámolt fix szorzó futásidejű float szorzások helyett
        float t = u_fx_seed * 45.0;
        
        vec2 rotatedUv = rotate2D(vuv, u_fx_angle, u_fx_position);
        vec2 noiseUv = rotatedUv * u_fx_scale;
        noiseUv.y /= u_fx_stretch;
        
        vec2 warp = vec2(
          snoise(noiseUv + vec2(t * 0.1, 0.0)),
          snoise(noiseUv + vec2(0.0, t * 0.15))
        ) * 0.25;
        
        float n1 = fx_fbm(noiseUv + warp + vec2(t * 0.03, t * -0.015)) * 0.5 + 0.5;
        
        vec2 streakUv = vec2(rotatedUv.x * u_fx_scale * 0.15, rotatedUv.y * u_fx_scale * 2.5 / u_fx_stretch);
        float streak = snoise(streakUv + vec2(t * 0.1, t * -0.08)) * 0.5 + 0.5;
        streak = streak * streak; // Szupergyors négyzetre emelés pow() helyett
        
        float leakPattern = mix(n1, streak, 0.35);
        float maskNoise = snoise(rotatedUv * 1.8 + vec2(t * 0.05, t * -0.02)) * 0.07;
        float mask = smoothstep(0.55, 0.0, distance(rotatedUv.x, u_fx_position.x) + maskNoise);
        
        float finalIntensity = leakPattern * mask * u_fx_intensity;
        finalIntensity = clamp(finalIntensity, 0.0, 1.8);
        
        vec3 leakColor = vec3(0.0);
        float redFactor = smoothstep(0.02, 0.45, finalIntensity);
        float greenFactor = smoothstep(0.18, 0.85, finalIntensity) * (u_fx_hue * 0.65);
        float blueFactor = smoothstep(0.35, 0.95, finalIntensity) * (u_fx_hue * 0.45);
        
        leakColor.r = redFactor;
        leakColor.g = min(greenFactor, redFactor * 0.92);
        leakColor.b = min(blueFactor, leakColor.g * 0.85);
        
        float redHalo = smoothstep(0.005, 0.15, finalIntensity) * (1.0 - smoothstep(0.15, 0.35, finalIntensity));
        leakColor.r += redHalo * 0.25;
        
        if (u_fx_bw > 0.5) {
          float grayLeak = dot(leakColor, vec3(0.299, 0.587, 0.114));
          leakColor = vec3(grayLeak);
        }
        
        vec3 washedBase = col + (leakColor * 0.28);
        vec3 finalColor = washedBase + (leakColor * u_fx_intensity);
        col = mix(col, clamp(finalColor + (leakColor * col * u_fx_overexposure * 2.2), 0.0, 1.0), 1.0);
      }
    `
  }
};