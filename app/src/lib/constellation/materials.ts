/**
 * Hologram shaders. Everything is projected light: additive, depth-tested
 * but not depth-writing, so overlapping bodies brighten rather than hide one
 * another. The only opaque things are the dark cores inside each node,
 * which give the bodies their solidity.
 *
 * Colours arrive as uniforms from theme tokens (see `scene.ts`); there are
 * no literal colours here. `uMotion` is 0 under reduced motion, which stops
 * every time-driven effect (twinkle, pulses, the floor ripple). Nothing
 * flickers, sweeps or scans: the bodies hold steady.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FrontSide,
  IUniform,
  NormalBlending,
  ShaderMaterial,
  Texture,
} from 'three';

export interface SharedUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uGlow: IUniform<number>;
  uPixelRatio: IUniform<number>;
}

export function sharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uMotion: { value: 1 },
    uGlow: { value: 0.8 },
    uPixelRatio: { value: 1 },
  };
}

const BILLBOARD_VERTEX = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
  }
`;

const additive = {
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
} as const;

/** The translucent shell of a body: a faint fill and a fresnel rim. */
export function shellMaterial(
  shared: SharedUniforms,
  opts: { color: Color; fill: number },
): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    side: FrontSide,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uOpacity: { value: 1 },
      uFill: { value: opts.fill },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uFill, uGlow;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float rim = pow(1.0 - facing, 2.4);
        float a = uFill + rim * (0.55 + 0.45 * uGlow);
        vec3 c = mix(uColor, vec3(1.0), rim * 0.3);
        gl_FragColor = vec4(c, a * uOpacity);
      }
    `,
  });
}

/**
 * The dark heart of a node. Opaque and depth-writing, so orbits and stars
 * behind a planet are hidden by it; tinted towards the hologram at the edge.
 */
export function coreMaterial(opts: { space: Color; tint: Color }): ShaderMaterial {
  return new ShaderMaterial({
    blending: NormalBlending,
    uniforms: {
      uSpace: { value: opts.space },
      uTint: { value: opts.tint },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSpace, uTint;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        vec3 c = mix(uSpace, uTint, 0.05 + 0.14 * pow(1.0 - facing, 1.5)) * mix(0.55, 1.0, uOpacity);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/** 1px wire lines: globe graticules, device edges, drop lines. */
export function wireMaterial(
  shared: SharedUniforms,
  opts: { color: Color; opacity: number; dashed?: boolean },
): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uOpacity: { value: opts.opacity },
    },
    defines: opts.dashed ? { DASHED: 1 } : {},
    vertexShader: /* glsl */ `
      varying float vY;
      void main() {
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vY;
      void main() {
        float a = uOpacity;
        #ifdef DASHED
          a *= step(0.45, fract(vY * 2.5));
        #endif
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

/**
 * A flat ring drawn by the fragment shader, so its width is in world units
 * and stays anti-aliased at any zoom. `trail` brightens the arc just behind
 * `uHead` (a fraction of a turn), like a comet tail along the orbit;
 * `dashes` cuts it into segments.
 */
export function ringMaterial(
  shared: SharedUniforms,
  opts: { color: Color; radius: number; width: number; opacity: number; trail?: number; dashes?: number },
): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    side: DoubleSide,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uRadius: { value: opts.radius },
      uWidth: { value: opts.width },
      uOpacity: { value: opts.opacity },
      uHead: { value: 0 },
      uTrail: { value: opts.trail ?? 0 },
      uDashes: { value: opts.dashes ?? 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uRadius, uWidth, uOpacity, uHead, uTrail, uDashes;
      varying vec2 vLocal;
      void main() {
        float r = length(vLocal);
        float aa = fwidth(r);
        float hw = max(uWidth * 0.5, aa * 0.6);
        float line = 1.0 - smoothstep(hw - aa * 0.5, hw + aa * 0.5, abs(r - uRadius));
        // Thinner than a pixel: fade instead of shimmering.
        line *= min(1.0, uWidth * 0.5 / hw);
        float t = fract(atan(vLocal.y, vLocal.x) / 6.28318530718);
        float a = line * uOpacity;
        if (uTrail > 0.0) {
          float behind = fract(uHead - t);
          a *= mix(1.0 - uTrail, 1.0, pow(1.0 - behind, 6.0));
        }
        if (uDashes > 0.0) a *= step(0.5, fract(t * uDashes));
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

/**
 * Rounded themes: a node as its 2D planet sprite (the same drawing as the
 * planet avatars), on a billboard. Opaque where the planet is, so it hides
 * the orbits behind it; the soft edge is cut rather than blended into depth.
 */
export function planetMaterial(shared: SharedUniforms, opts: { map: Texture }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    blending: NormalBlending,
    uniforms: {
      ...shared,
      uMap: { value: opts.map },
      uSize: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        if (c.a < 0.04) discard;
        gl_FragColor = vec4(c.rgb, c.a * uOpacity);
      }
    `,
  });
}

/** Rounded themes: a moon as a small solid dot that always faces the camera. */
export function dotMaterial(shared: SharedUniforms, opts: { color: Color }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uSize: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float edge = fwidth(d);
        float a = 1.0 - smoothstep(1.0 - edge * 1.5, 1.0, d);
        if (a <= 0.0) discard;
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `,
  });
}

/** Rounded themes: a device as a solid, flat-shaded shape. */
export function solidMaterial(opts: { color: Color }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    blending: NormalBlending,
    uniforms: {
      uColor: { value: opts.color },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(uColor * (0.5 + 0.5 * facing), uOpacity);
      }
    `,
  });
}

/** A soft round glow that always faces the camera. */
export function glowMaterial(shared: SharedUniforms, opts: { color: Color; size: number; intensity: number }): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uSize: { value: opts.size },
      uIntensity: { value: opts.intensity },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity, uGlow;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float g = exp(-d * d * 5.0) * (1.0 - smoothstep(0.7, 1.0, d));
        gl_FragColor = vec4(uColor, g * uIntensity * (0.4 + 0.6 * uGlow));
      }
    `,
  });
}

/**
 * A node's gauge: CPU as a segmented outer arc, memory as a thin inner one,
 * both clockwise from the top, on a faint track. Faces the camera.
 */
export function gaugeMaterial(
  shared: SharedUniforms,
  opts: { cpu: Color; mem: Color; track: Color; size: number },
): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: {
      ...shared,
      uSize: { value: opts.size },
      uCpu: { value: 0 },
      uMem: { value: 0 },
      uCpuColor: { value: opts.cpu },
      uMemColor: { value: opts.mem },
      uTrack: { value: opts.track },
      uOpacity: { value: 1 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform float uCpu, uMem, uOpacity;
      uniform vec3 uCpuColor, uMemColor, uTrack;
      varying vec2 vUv;
      float band(float r, float r0, float r1) {
        float aa = fwidth(r);
        return smoothstep(r0 - aa, r0, r) * (1.0 - smoothstep(r1, r1 + aa, r));
      }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float t = fract(atan(p.x, p.y) / 6.28318530718 + 1.0);
        // 60 ticks with gaps, on the outer arc.
        float tick = step(0.22, fract(t * 60.0));
        float outer = band(r, 0.86, 0.95) * tick;
        float cpuOn = step(t, uCpu);
        vec3 c = mix(uTrack, uCpuColor, cpuOn);
        float a = outer * mix(0.22, 0.95, cpuOn);
        float inner = band(r, 0.8, 0.825);
        float memOn = step(t, uMem);
        c = mix(c, mix(uTrack, uMemColor, memOn), inner);
        a = max(a, inner * mix(0.18, 0.8, memOn));
        gl_FragColor = vec4(c, a * uOpacity);
      }
    `,
  });
}

/** Four corner brackets turning slowly around whatever has focus. */
export function reticleMaterial(shared: SharedUniforms, opts: { color: Color; size: number }): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uSize: { value: opts.size },
      uOpacity: { value: 0 },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity, uTime, uMotion;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float aa = fwidth(r);
        float ring = smoothstep(0.9 - aa, 0.9, r) * (1.0 - smoothstep(0.94, 0.94 + aa, r));
        float t = fract(atan(p.x, p.y) / 6.28318530718 + uTime * 0.05 * uMotion);
        float arcs = step(fract(t * 4.0), 0.16);
        float ticks = smoothstep(0.97 - aa, 0.97, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r)) * step(fract(t * 4.0 + 0.92), 0.02);
        gl_FragColor = vec4(uColor, (ring * arcs + ticks) * uOpacity);
      }
    `,
  });
}

/** An expanding ring, for a device being woken. */
export function pulseMaterial(shared: SharedUniforms, opts: { color: Color; size: number }): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uSize: { value: opts.size },
    },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime, uMotion;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        // Reduced motion holds one ring at half size.
        float phase = mix(0.5, fract(uTime * 0.7), uMotion);
        float aa = fwidth(r);
        float ring = 1.0 - smoothstep(0.03, 0.03 + aa * 1.5, abs(r - (0.25 + phase * 0.7)));
        gl_FragColor = vec4(uColor, ring * (1.0 - phase) * 0.9);
      }
    `,
  });
}

/**
 * The projection floor: concentric rings (every fourth brighter), radial
 * spokes and a faint centre glow, fading out towards the edge.
 */
export function gridMaterial(shared: SharedUniforms, opts: { color: Color; radius: number; step: number }): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    side: DoubleSide,
    uniforms: {
      ...shared,
      uColor: { value: opts.color },
      uRadius: { value: opts.radius },
      uStep: { value: opts.step },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uRadius, uStep, uOpacity, uTime, uMotion;
      varying vec2 vP;
      float gridLine(float v, float width) {
        float w = fwidth(v);
        return 1.0 - smoothstep(width * w, (width + 1.0) * w, abs(fract(v - 0.5) - 0.5));
      }
      void main() {
        float r = length(vP);
        if (r > uRadius) discard;
        float rings = gridLine(r / uStep, 0.5);
        float major = gridLine(r / (uStep * 4.0), 0.8);
        float spokes = gridLine(atan(vP.y, vP.x) / 6.28318530718 * 24.0, 0.5) * smoothstep(uStep, uStep * 2.5, r);
        float fade = pow(1.0 - r / uRadius, 1.4);
        // A slow ripple outward from the centre, like a projector scanning.
        float wave = exp(-pow((r / uRadius - fract(uTime * 0.04)) * 18.0, 2.0)) * uMotion;
        float a = (rings * 0.16 + major * 0.22 + spokes * 0.07 + wave * 0.08) * fade + 0.05 * fade * fade;
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `,
  });
}

/** Stars: round points, constant on-screen size, twinkling unless motion is reduced. */
export function starMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    ...additive,
    uniforms: { ...shared, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aColor;
      uniform float uPixelRatio, uTime, uMotion;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = aColor;
        vTwinkle = 1.0 - uMotion * 0.45 * (0.5 + 0.5 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0));
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * vTwinkle * uOpacity;
        gl_FragColor = vec4(vColor, a);
      }
    `,
  });
}
