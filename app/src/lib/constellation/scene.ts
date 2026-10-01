/**
 * The 3D constellation: one three.js scene, its camera and controls, its
 * animation loop and the labels over it. React mounts it and feeds it
 * snapshots and host samples; nothing here goes through React state.
 *
 * Rendering is on demand. Orbits move at 30 fps, the camera at the display's
 * rate while it is being moved or flown, and under reduced motion a frame is
 * drawn only when data, input or the size changes. Resizing renders inside
 * the ResizeObserver callback, so the resized canvas is never shown blank.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LinearSRGBColorSpace,
  Line,
  LineSegments,
  Material,
  Mesh,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { HostInfo } from '@/generated/HostInfo';
import { canvasTokens, onThemeChange } from '@/lib/theme-tokens';
import { planetStyle } from '@/lib/planet';
import { cssToRgba, ensureLightness, Rgba, rgbaToHex } from './colors';
import {
  Body,
  FocusState,
  focusOrder,
  interact,
  Intent,
  isEmptyDiff,
  Layout,
  MoonBody,
  NodeBody,
  pick,
  ProbeBody,
  ProbeShape,
  reconcile,
  ScreenBody,
  shellCount,
  Snapshot,
  stepFocus,
} from './model';
import { LabelLayer } from './hud';
import {
  coreMaterial,
  gaugeMaterial,
  glowMaterial,
  gridMaterial,
  pulseMaterial,
  reticleMaterial,
  ringMaterial,
  sharedUniforms,
  SharedUniforms,
  shellMaterial,
  starMaterial,
  wireMaterial,
} from './materials';

export type Variant = 'card' | 'full';

export interface FocusInfo {
  /** The node the camera is on. */
  selected: string | null;
  /** What the pointer is over. */
  hovered: string | null;
  /** The label with keyboard focus. */
  focused: string | null;
}

export interface SceneOptions {
  variant: Variant;
  reducedMotion: boolean;
  onFocusChange(info: FocusInfo): void;
  onOpen(body: Body): void;
}

export interface SceneStats {
  /** Mean CPU time per drawn frame over the last second, ms. */
  frameMs: number;
  /** Frames drawn over the last second. */
  fps: number;
  drawCalls: number;
  triangles: number;
}

const TAU = Math.PI * 2;
/** Idle frame interval: orbits are slow, 30 fps is plenty. */
const IDLE_FRAME_MS = 1000 / 30;
const MAX_DPR = 2;
const FOV = 38;
/** Camera elevation over the orbital plane at home, radians. */
const HOME_ELEVATION = 0.52;
const HOME_AZIMUTH = 0.75;
const FLIGHT_MS = 950;
const ZOOM_MS = 320;
/** Auto-rotate resumes after this long without input. */
const IDLE_ROTATE_MS = 20_000;
/** Moon shell radius, collapsed and spread (when its node has focus). */
const MOON_BASE = 1.9;
const MOON_SPREAD = 2.7;
const SHELL_GAP = 0.8;
const SHELL_GAP_SPREAD = 1.5;
const PROBE_TILT = 0.24;
const PROBE_SIZE = 0.42;

type Role = 'primary' | 'secondary' | 'text' | 'dim' | 'ok' | 'warn' | 'err' | 'probe';

/** Theme colours as three.js colours, updated in place so every uniform that holds one follows. */
interface Palette extends Record<Role, Color> {
  space: Color;
}

interface RingView {
  mesh: Mesh<RingGeometry, ShaderMaterial>;
  builtFor: number;
  width: number;
}

interface NodeView {
  body: NodeBody;
  group: Group;
  core: Mesh<SphereGeometry, ShaderMaterial>;
  shell: Mesh<SphereGeometry, ShaderMaterial>;
  wire: LineSegments<BufferGeometry, ShaderMaterial>;
  rings: LineSegments<BufferGeometry, ShaderMaterial> | null;
  glow: Mesh<PlaneGeometry, ShaderMaterial>;
  gauge: Mesh<PlaneGeometry, ShaderMaterial>;
  orbit: RingView;
  drop: LineSegments<BufferGeometry, ShaderMaterial>;
  foot: RingView;
  link: Line<BufferGeometry, ShaderMaterial>;
  shells: { ring: RingView; tilt: Quaternion; angle: number; speed: number }[];
  angle: number;
  orbitR: number;
  radius: number;
  /** Eases to 1 when this node is selected; spreads its moons. */
  spread: number;
  /** Eases to a lower value when another node is selected. */
  presence: number;
  cpu: number;
  mem: number;
  unsubscribe: () => void;
}

interface MoonView {
  body: MoonBody;
  mesh: Mesh<IcosahedronGeometry, ShaderMaterial>;
  halo: Mesh<PlaneGeometry, ShaderMaterial> | null;
  /** Current slot, eased towards the body's. */
  slot: number;
  size: number;
}

interface ProbeView {
  body: ProbeBody;
  group: Group;
  edges: LineSegments<BufferGeometry, ShaderMaterial>;
  fill: Mesh<BufferGeometry, ShaderMaterial>;
  pulse: Mesh<PlaneGeometry, ShaderMaterial> | null;
  slot: number;
}

interface Flight {
  start: number;
  duration: number;
  fromTarget: Vector3;
  fromOffset: Vector3;
  /** Where to end; read every frame, since a node keeps moving during the flight. */
  to: () => { target: Vector3; offset: Vector3 };
}

/** Deterministic random numbers, so the sky is the same on every visit. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

function setColor(c: Color, rgba: Rgba) {
  // Raw sRGB values in, raw values out: the renderer's output is linear, so
  // nothing is converted and the hologram matches the CSS it came from.
  c.setRGB(rgba.r, rgba.g, rgba.b);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const approach = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/** Shortest way round from one turn fraction to another. */
function approachTurn(from: number, to: number, rate: number, dt: number): number {
  const d = ((to - from + 1.5) % 1) - 0.5;
  return from + d * (1 - Math.exp(-rate * dt));
}

/** Latitude and longitude lines on the unit sphere, for gas and ice giants. */
function graticule(lat: number, lon: number, segments = 64): BufferGeometry {
  const pts: number[] = [];
  const r = 1.004;
  for (let i = 1; i < lat; i += 1) {
    const phi = (i / lat) * Math.PI;
    const y = Math.cos(phi) * r;
    const rr = Math.sin(phi) * r;
    for (let s = 0; s < segments; s += 1) {
      const a0 = (s / segments) * TAU;
      const a1 = ((s + 1) / segments) * TAU;
      pts.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
    }
  }
  for (let j = 0; j < lon; j += 1) {
    const a = (j / lon) * TAU;
    for (let s = 0; s < segments / 2; s += 1) {
      const p0 = (s / (segments / 2)) * Math.PI;
      const p1 = ((s + 1) / (segments / 2)) * Math.PI;
      pts.push(
        Math.cos(a) * Math.sin(p0) * r, Math.cos(p0) * r, Math.sin(a) * Math.sin(p0) * r,
        Math.cos(a) * Math.sin(p1) * r, Math.cos(p1) * r, Math.sin(a) * Math.sin(p1) * r,
      );
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

/** Concentric circles in the XZ plane, for a planet's rings. */
function ringLines(inner: number, outer: number, count: number, segments = 96): BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const r = inner + ((outer - inner) * i) / Math.max(count - 1, 1);
    for (let s = 0; s < segments; s += 1) {
      const a0 = (s / segments) * TAU;
      const a1 = ((s + 1) / segments) * TAU;
      pts.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

function probeGeometry(shape: ProbeShape): BufferGeometry {
  switch (shape) {
    case 'phone':
      return new OctahedronGeometry(1);
    case 'computer':
      return new IcosahedronGeometry(1, 0);
    case 'server':
      return new BoxGeometry(1.25, 1.25, 1.25);
    case 'other':
      return new TetrahedronGeometry(1.1);
  }
}

/** Shared geometries, made once per scene. */
class Geometries {
  sphere = new SphereGeometry(1, 48, 32);
  moon = new IcosahedronGeometry(1, 2);
  plane = new PlaneGeometry(1, 1);
  graticuleGas = graticule(9, 12);
  graticuleIce = graticule(5, 8);
  geodesic = new EdgesGeometry(new IcosahedronGeometry(1.004, 1), 1);
  probes = new Map<ProbeShape, { solid: BufferGeometry; edges: EdgesGeometry }>();

  probe(shape: ProbeShape) {
    let g = this.probes.get(shape);
    if (!g) {
      const solid = probeGeometry(shape);
      g = { solid, edges: new EdgesGeometry(solid) };
      this.probes.set(shape, g);
    }
    return g;
  }

  dispose() {
    for (const g of [this.sphere, this.moon, this.plane, this.graticuleGas, this.graticuleIce, this.geodesic]) g.dispose();
    for (const { solid, edges } of this.probes.values()) {
      solid.dispose();
      edges.dispose();
    }
  }
}

export class ConstellationScene {
  private readonly renderer: WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera = new PerspectiveCamera(FOV, 2, 0.1, 1500);
  private readonly controls: OrbitControls;
  private readonly scene = new Scene();
  private readonly world = new Group();
  private readonly probeRing = new Group();
  private readonly shared: SharedUniforms = sharedUniforms();
  private readonly geo = new Geometries();
  private readonly palette: Palette;
  private readonly labels: LabelLayer;

  private layout: Layout | null = null;
  private nodes = new Map<string, NodeView>();
  private moons = new Map<string, MoonView>();
  private probes = new Map<string, ProbeView>();
  private probeWorld = new Vector3();
  private stars: Points<BufferGeometry, ShaderMaterial>;
  private grid: Mesh<PlaneGeometry, ShaderMaterial>;
  private gridDrop = 3;
  private probeOrbit: RingView;
  private core: Group;
  private coreGlow: Mesh<PlaneGeometry, ShaderMaterial>;
  private coreRings: RingView[] = [];
  private reticle: Mesh<PlaneGeometry, ShaderMaterial>;

  private focusState: FocusState = { selected: null };
  /** A node asked for before it arrived. */
  private pendingSelect: string | null = null;
  private hovered: string | null = null;
  private focusedLabel: string | null = null;
  private lastFocusInfo = '';

  private width = 0;
  private height = 0;
  private raf = 0;
  private dirty = true;
  private paused = false;
  private onScreen = true;
  private lost = false;
  private disposed = false;
  private lastFrame = 0;
  private simTime = 0;
  private probeAngle = 0;
  private flight: Flight | null = null;
  private atHome = true;
  private interacting = false;
  private lastInput = -Infinity;
  private followFrom = new Vector3();
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private frameTimes: number[] = [];
  private frameStamps: number[] = [];

  private readonly stops: (() => void)[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(
    private readonly wrapper: HTMLElement,
    overlay: HTMLElement,
    private readonly source: {
      onHost(nodeId: string, fn: (host: HostInfo) => void): () => void;
    },
    private readonly opts: SceneOptions,
  ) {
    // Our own canvas, not React's: a WebGL context can't be re-made on a
    // canvas whose context was lost on purpose, which StrictMode's
    // mount-unmount-mount would otherwise do.
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.constellationCanvas = '';
    // Absolute: an in-flow canvas feeds its pixel size back into layout in WebKit.
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    wrapper.prepend(this.canvas);

    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        // A dashboard shouldn't wake a discrete GPU.
        powerPreference: 'low-power',
      });
    } catch (e) {
      this.canvas.remove();
      throw e;
    }
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));

    const color = () => new Color();
    this.palette = {
      space: color(), primary: color(), secondary: color(), text: color(), dim: color(),
      ok: color(), warn: color(), err: color(), probe: color(),
    };
    this.shared.uMotion.value = opts.reducedMotion ? 0 : 1;

    this.scene.add(this.world);
    this.world.add(this.probeRing);
    this.probeRing.rotation.set(PROBE_TILT, 0, 0.14);

    this.stars = this.makeStars();
    this.scene.add(this.stars);
    this.grid = new Mesh(this.geo.plane, gridMaterial(this.shared, { color: this.palette.primary, radius: 1, step: 2 }));
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.renderOrder = -2;
    this.world.add(this.grid);

    this.probeOrbit = this.makeRing(this.palette.probe, 1, 0.05, 0.4, { dashes: 160 });
    this.probeOrbit.mesh.rotation.x = Math.PI / 2;
    this.probeRing.add(this.probeOrbit.mesh);

    this.core = new Group();
    this.coreGlow = new Mesh(this.geo.plane, glowMaterial(this.shared, { color: this.palette.primary, size: 5, intensity: 0.55 }));
    this.coreGlow.frustumCulled = false;
    this.core.add(this.coreGlow);
    for (const [r, dashes] of [[0.9, 24], [1.35, 64]] as const) {
      const ring = this.makeRing(this.palette.primary, r, 0.05, 0.55, { dashes });
      ring.mesh.rotation.x = Math.PI / 2;
      this.coreRings.push(ring);
      this.core.add(ring.mesh);
    }
    this.world.add(this.core);

    this.reticle = new Mesh(this.geo.plane, reticleMaterial(this.shared, { color: this.palette.text, size: 1 }));
    this.reticle.frustumCulled = false;
    this.reticle.renderOrder = 10;
    this.scene.add(this.reticle);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.autoRotateSpeed = 0.35;
    if (opts.variant === 'card') {
      // In a scrolling page: vertical swipes scroll, horizontal ones orbit,
      // two fingers zoom.
      this.canvas.style.touchAction = 'pan-y';
    }
    this.controls.addEventListener('start', this.onControlsStart);
    this.controls.addEventListener('end', this.onControlsEnd);
    this.controls.addEventListener('change', this.onControlsChange);

    this.labels = new LabelLayer(overlay, {
      activate: (key) => this.dispatch({ type: 'activate', key }),
      focus: (key) => {
        this.focusedLabel = key;
        this.emitFocus();
        this.invalidate();
      },
      hover: (key) => this.setHover(key),
      back: () => {
        const was = this.focusState.selected;
        if (!was) return false;
        this.dispatch({ type: 'back' });
        // Back to the node whose moons we were in.
        this.labels.focus(was);
        return true;
      },
      zoom: (direction) => this.zoom(direction),
      step: (from, delta) => (this.layout ? stepFocus(focusOrder(this.layout, this.focusState.selected), from, delta) : null),
    });

    this.applyTheme();
    this.stops.push(onThemeChange(() => this.applyTheme()));

    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      this.resize(box.width, box.height);
    });
    ro.observe(wrapper);
    this.stops.push(() => ro.disconnect());

    const io = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting;
      this.updatePaused();
    });
    io.observe(wrapper);
    this.stops.push(() => io.disconnect());

    const onVisibility = () => this.updatePaused();
    document.addEventListener('visibilitychange', onVisibility);
    this.stops.push(() => document.removeEventListener('visibilitychange', onVisibility));

    type Events = HTMLElementEventMap & { webglcontextlost: Event; webglcontextrestored: Event };
    const listen = <K extends keyof Events & string>(type: K, fn: (e: Events[K]) => void) => {
      const listener = fn as EventListener;
      this.canvas.addEventListener(type, listener);
      this.stops.push(() => this.canvas.removeEventListener(type, listener));
    };
    listen('pointermove', this.onPointerMove);
    listen('pointerdown', this.onPointerDown);
    listen('pointerup', this.onPointerUp);
    listen('pointerleave', () => this.setHover(null));
    listen('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    listen('webglcontextrestored', () => {
      this.lost = false;
      this.invalidate();
    });

    // A first size from layout, before the observer's first callback.
    const rect = wrapper.getBoundingClientRect();
    this.resize(rect.width, rect.height);
  }

  // --- public ---------------------------------------------------------------

  setSnapshot(snap: Snapshot) {
    const { layout, diff } = reconcile(this.layout, snap);
    const firstLayout = this.layout === null;
    this.layout = layout;
    if (isEmptyDiff(diff) && !firstLayout) return;

    for (const key of diff.removed) this.removeBody(key);
    for (const key of diff.added) this.addBody(layout.byKey.get(key)!);
    for (const key of diff.changed) this.updateBody(layout.byKey.get(key)!);
    // Moons belong to nodes; make sure every view points at the current body.
    for (const view of this.nodes.values()) view.body = layout.byKey.get(view.body.key) as NodeBody;
    for (const view of this.moons.values()) view.body = layout.byKey.get(view.body.key) as MoonBody;
    for (const view of this.probes.values()) view.body = layout.byKey.get(view.body.key) as ProbeBody;

    if (this.focusState.selected && !layout.byKey.has(this.focusState.selected)) {
      this.focusState = { selected: null };
      this.flyTo(null);
    }
    if (this.hovered && !layout.byKey.has(this.hovered)) this.hovered = null;

    this.relayoutWorld();
    this.labels.sync(layout, this.focusState.selected);
    if (this.atHome && !this.flight) this.goHome(true);
    if (this.pendingSelect && layout.byKey.has(this.pendingSelect)) {
      // Settle positions first, so the camera lands where the node is.
      this.simulate(0, 0);
      this.select(this.pendingSelect, true);
    }
    this.emitFocus();
    this.invalidate();
  }

  /** Focuses a node or device (or home, for null), e.g. from a link. */
  select(key: string | null, instant = false) {
    if (!this.layout || (key && !this.layout.byKey.has(key))) {
      this.pendingSelect = key;
      return;
    }
    this.pendingSelect = null;
    this.focusState = { selected: key };
    this.labels.sync(this.layout, key);
    this.flyTo(key, instant);
    this.emitFocus();
  }

  zoom(direction: 1 | -1) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const len = Math.min(
      Math.max(offset.length() * (direction > 0 ? 0.75 : 1 / 0.75), this.controls.minDistance),
      this.controls.maxDistance,
    );
    const target = this.controls.target.clone();
    const end = offset.setLength(len);
    this.atHome = false;
    this.lastInput = performance.now();
    this.startFlight(() => ({ target: this.focusTarget() ?? target, offset: end }), ZOOM_MS);
  }

  resetView() {
    this.focusState = { selected: null };
    if (this.layout) this.labels.sync(this.layout, null);
    this.lastInput = -Infinity;
    this.flyTo(null, false, true);
    this.emitFocus();
  }

  /** As a click on the body: focuses a node, opens anything else (or a focused node). */
  activate(key: string) {
    this.dispatch({ type: 'activate', key });
  }

  focusLabel(key: string) {
    this.labels.focus(key);
  }

  /** The scanlines on bodies (Settings); the overlay's are CSS. */
  setScanlines(on: boolean) {
    this.shared.uScan.value = on ? 1 : 0;
    this.invalidate();
  }

  stats(): SceneStats {
    const n = this.frameTimes.length;
    return {
      frameMs: n ? this.frameTimes.reduce((a, b) => a + b, 0) / n : 0,
      fps: this.frameStamps.length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const stop of this.stops) stop();
    for (const view of this.nodes.values()) view.unsubscribe();
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.removeEventListener('end', this.onControlsEnd);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.dispose();
    this.labels.dispose();

    const materials = new Set<Material>();
    const geometries = new Set<BufferGeometry>();
    this.scene.traverse((obj) => {
      const o = obj as Partial<Mesh>;
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
    });
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();
    this.geo.dispose();
    this.renderer.dispose();
    // Release the context now rather than whenever the GC gets to it:
    // browsers cap live contexts, and going back and forth adds them up.
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // --- bodies ---------------------------------------------------------------

  private makeRing(
    color: Color,
    radius: number,
    width: number,
    opacity: number,
    extra: { trail?: number; dashes?: number } = {},
  ): RingView {
    const band = Math.max(0.5 / radius, 0.004);
    const mesh = new Mesh(
      new RingGeometry(1 - band, 1 + band, 192, 1),
      ringMaterial(this.shared, { color, radius: 1, width: width / radius, opacity, ...extra }),
    );
    mesh.scale.setScalar(radius);
    return { mesh, builtFor: radius, width };
  }

  private setRingRadius(ring: RingView, radius: number) {
    const r = Math.max(radius, 0.01);
    if (Math.abs(r / ring.builtFor - 1) > 0.25) {
      const band = Math.max(0.5 / r, 0.004);
      ring.mesh.geometry.dispose();
      ring.mesh.geometry = new RingGeometry(1 - band, 1 + band, 192, 1);
      ring.builtFor = r;
    }
    ring.mesh.scale.setScalar(r);
    ring.mesh.material.uniforms.uWidth.value = ring.width / r;
  }

  private addBody(body: Body) {
    if (body.kind === 'node') this.addNode(body);
    else if (body.kind === 'moon') this.addMoon(body);
    else this.addProbe(body);
  }

  private addNode(body: NodeBody) {
    const p = this.palette;
    const seed = hashString(body.id);
    const style = planetStyle(body.name);
    const group = new Group();

    const core = new Mesh(this.geo.sphere, coreMaterial({ space: p.space, tint: p.primary }));
    core.scale.setScalar(0.985);
    const shell = new Mesh(this.geo.sphere, shellMaterial(this.shared, { color: p.primary, fill: 0.03, lines: 11 }));
    const wireGeo = style.kind === 'rocky' ? this.geo.geodesic : style.kind === 'ice' ? this.geo.graticuleIce : this.geo.graticuleGas;
    const wire = new LineSegments(wireGeo, wireMaterial(this.shared, { color: p.primary, opacity: 0.32 }));
    // Gas giants spin on a tilted axis; the lines show it.
    wire.rotation.z = (seed - 0.5) * 0.5;
    group.add(core, shell, wire);

    let rings: NodeView['rings'] = null;
    if (style.ring) {
      rings = new LineSegments(
        ringLines(style.ring.inner, style.ring.outer, 5),
        wireMaterial(this.shared, { color: p.primary, opacity: 0.4 }),
      );
      rings.rotation.set(Math.PI / 2 + style.ring.tilt * 0.5 - Math.PI / 2, 0, style.ring.tilt * 0.6);
      group.add(rings);
    }

    const glow = new Mesh(this.geo.plane, glowMaterial(this.shared, { color: p.primary, size: 1, intensity: 0.5 }));
    glow.frustumCulled = false;
    glow.renderOrder = -1;
    const gauge = new Mesh(this.geo.plane, gaugeMaterial(this.shared, { cpu: p.primary, mem: p.secondary, track: p.dim, size: 1 }));
    gauge.frustumCulled = false;
    group.add(glow, gauge);

    const orbit = this.makeRing(p.primary, Math.max(body.orbit, 0.01), 0.06, 0.5, { trail: 0.82 });
    orbit.mesh.rotation.x = Math.PI / 2;
    const dropGeo = new BufferGeometry();
    dropGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const drop = new LineSegments(dropGeo, wireMaterial(this.shared, { color: p.primary, opacity: 0.28, dashed: true }));
    drop.frustumCulled = false;
    const foot = this.makeRing(p.primary, 1, 0.05, 0.45, { dashes: 24 });
    foot.mesh.rotation.x = Math.PI / 2;
    const linkGeo = new BufferGeometry();
    linkGeo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const link = new Line(linkGeo, wireMaterial(this.shared, { color: p.primary, opacity: 0.12 }));
    link.frustumCulled = false;
    this.world.add(group, orbit.mesh, drop, foot.mesh, link);

    const view: NodeView = {
      body,
      group,
      core,
      shell,
      wire,
      rings,
      glow,
      gauge,
      orbit,
      drop,
      foot,
      link,
      shells: [],
      angle: body.phase,
      orbitR: body.orbit,
      radius: body.radius,
      spread: 0,
      presence: 1,
      cpu: 0,
      mem: 0,
      unsubscribe: () => {},
    };
    this.nodes.set(body.key, view);
    this.syncShells(view);
    this.styleNode(view);
    view.unsubscribe = this.source.onHost(body.id, (host) => {
      view.cpu = Math.min(Math.max(host.cpu_pct / 100, 0), 1);
      view.mem = host.mem_total_bytes > 0 ? Math.min(host.mem_used_bytes / host.mem_total_bytes, 1) : 0;
      this.labels.setSub(body.key, view.body.state === 'online' ? `${Math.round(host.cpu_pct)}% cpu` : this.nodeSub(view.body));
      this.styleGauge(view);
      if (this.opts.reducedMotion) this.invalidate();
    });
  }

  private nodeSub(body: NodeBody): string {
    return { online: '', connecting: 'connecting', offline: 'offline', unauthorized: 'sign in needed' }[body.state];
  }

  /** One faint ring per moon shell, each on its own tilt. */
  private syncShells(view: NodeView) {
    const want = shellCount(view.body.moonKeys.length);
    while (view.shells.length > want) {
      const s = view.shells.pop()!;
      s.ring.mesh.removeFromParent();
      s.ring.mesh.geometry.dispose();
      s.ring.mesh.material.dispose();
    }
    const seed = hashString(view.body.id);
    while (view.shells.length < want) {
      const i = view.shells.length;
      const ring = this.makeRing(this.palette.secondary, MOON_BASE * view.radius + i * SHELL_GAP, 0.03, 0.22);
      const tilt = new Quaternion().setFromAxisAngle(
        new Vector3(Math.cos(seed * TAU + i), 0, Math.sin(seed * TAU + i)),
        (i % 2 ? -1 : 1) * (0.32 + i * 0.12),
      );
      // The ring geometry lies in XY; turn it into the shell's plane.
      ring.mesh.quaternion.copy(tilt).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
      view.group.add(ring.mesh);
      view.shells.push({ ring, tilt, angle: seed * TAU, speed: (i % 2 ? -1 : 1) * (0.22 / (1 + i * 0.6)) });
    }
  }

  private addMoon(body: MoonBody) {
    const mesh = new Mesh(
      this.geo.moon,
      shellMaterial(this.shared, { color: this.palette.secondary, fill: 0.32, lines: 3 }),
    );
    this.world.add(mesh);
    const view: MoonView = { body, mesh, halo: null, slot: body.slot, size: 0.2 };
    this.moons.set(body.key, view);
    this.styleMoon(view);
  }

  private addProbe(body: ProbeBody) {
    const { solid, edges } = this.geo.probe(body.shape);
    const seed = hashString(body.id);
    const group = new Group();
    const edgeLines = new LineSegments(edges, wireMaterial(this.shared, { color: this.palette.probe, opacity: 0.9 }));
    const fill = new Mesh(solid, shellMaterial(this.shared, { color: this.palette.probe, fill: 0.06, lines: 2 }));
    group.add(edgeLines, fill);
    group.scale.setScalar(PROBE_SIZE);
    group.rotation.set(seed * TAU, seed * 3.1, 0);
    this.probeRing.add(group);
    const view: ProbeView = { body, group, edges: edgeLines, fill, pulse: null, slot: body.slot };
    this.probes.set(body.key, view);
    this.styleProbe(view);
  }

  private updateBody(body: Body) {
    if (body.kind === 'node') {
      const view = this.nodes.get(body.key);
      if (!view) return;
      view.body = body;
      this.syncShells(view);
      this.styleNode(view);
    } else if (body.kind === 'moon') {
      const view = this.moons.get(body.key);
      if (!view) return;
      view.body = body;
      this.styleMoon(view);
    } else {
      const view = this.probes.get(body.key);
      if (!view) return;
      // A different shape needs different geometry: start it afresh.
      if (view.body.shape !== body.shape) {
        this.removeBody(body.key);
        this.addProbe(body);
        return;
      }
      view.body = body;
      this.styleProbe(view);
    }
  }

  private removeBody(key: string) {
    const dispose = (obj: Mesh | LineSegments | Line | Group) => {
      obj.removeFromParent();
      obj.traverse((o) => {
        const m = o as Partial<Mesh>;
        if (m.material) (m.material as Material).dispose();
      });
    };
    const node = this.nodes.get(key);
    if (node) {
      node.unsubscribe();
      dispose(node.group);
      for (const s of node.shells) s.ring.mesh.geometry.dispose();
      node.rings?.geometry.dispose();
      for (const ring of [node.orbit, node.foot]) {
        dispose(ring.mesh);
        ring.mesh.geometry.dispose();
      }
      dispose(node.drop);
      node.drop.geometry.dispose();
      dispose(node.link);
      node.link.geometry.dispose();
      this.nodes.delete(key);
    }
    const moon = this.moons.get(key);
    if (moon) {
      dispose(moon.mesh);
      if (moon.halo) dispose(moon.halo);
      this.moons.delete(key);
    }
    const probe = this.probes.get(key);
    if (probe) {
      dispose(probe.group);
      if (probe.pulse) dispose(probe.pulse);
      this.probes.delete(key);
    }
  }

  // --- colours --------------------------------------------------------------

  private styleNode(view: NodeView) {
    const p = this.palette;
    const state = view.body.state;
    const tone = state === 'online' ? p.primary : state === 'connecting' ? p.dim : p.err;
    view.shell.material.uniforms.uColor.value = tone;
    view.wire.material.uniforms.uColor.value = tone;
    view.glow.material.uniforms.uColor.value = tone;
    view.core.material.uniforms.uTint.value = state === 'online' ? tone : p.dim;
    view.shell.material.uniforms.uFill.value = state === 'online' ? 0.03 : 0;
    if (view.rings) view.rings.material.uniforms.uColor.value = tone;
    view.gauge.visible = state === 'online';
    view.link.visible = state === 'online';
    if (state !== 'online') this.labels.setSub(view.body.key, this.nodeSub(view.body));
    this.styleGauge(view);
  }

  private styleGauge(view: NodeView) {
    const p = this.palette;
    const u = view.gauge.material.uniforms;
    u.uCpuColor.value = view.cpu > 0.95 ? p.err : view.cpu > 0.8 ? p.warn : p.primary;
  }

  private styleMoon(view: MoonView) {
    const p = this.palette;
    const s = view.body.state;
    view.mesh.material.uniforms.uColor.value = s === 'ok' ? p.secondary : s === 'partial' ? p.warn : s === 'down' ? p.err : p.dim;
    // A halo only on moons in trouble, so problems stand out from a distance.
    const troubled = s === 'partial' || s === 'down';
    if (troubled && !view.halo) {
      view.halo = new Mesh(this.geo.plane, glowMaterial(this.shared, { color: p.warn, size: 1.4, intensity: 0.8 }));
      view.halo.frustumCulled = false;
      this.world.add(view.halo);
    } else if (!troubled && view.halo) {
      view.halo.removeFromParent();
      view.halo.material.dispose();
      view.halo = null;
    }
    if (view.halo) view.halo.material.uniforms.uColor.value = s === 'down' ? p.err : p.warn;
  }

  private styleProbe(view: ProbeView) {
    const p = this.palette;
    const { online, wol } = view.body;
    const tone = online ? p.probe : p.dim;
    view.edges.material.uniforms.uColor.value = tone;
    view.edges.material.uniforms.uOpacity.value = online ? 0.95 : 0.4;
    view.fill.material.uniforms.uColor.value = tone;
    view.fill.material.uniforms.uOpacity.value = online ? 1 : 0.25;
    const waking = wol === 'waking';
    if (waking && !view.pulse) {
      view.pulse = new Mesh(this.geo.plane, pulseMaterial(this.shared, { color: p.warn, size: 2.6 }));
      view.pulse.frustumCulled = false;
      this.probeRing.add(view.pulse);
    } else if (!waking && view.pulse) {
      view.pulse.removeFromParent();
      view.pulse.material.dispose();
      view.pulse = null;
    }
  }

  private applyTheme() {
    const t = canvasTokens();
    const p = this.palette;
    const fallback = cssToRgba('#000');
    const read = (css: string) => cssToRgba(css, fallback);
    const space = read(t.holoSpace);
    setColor(p.space, space);
    setColor(p.primary, read(t.holoPrimary));
    setColor(p.secondary, read(t.holoSecondary));
    const text = read(t.holoText);
    setColor(p.text, text);
    setColor(p.dim, read(t.holoDim));
    // Status colours tuned for a light page are lifted until they read on the dark viewport.
    const ok = ensureLightness(read(t.success), 0.72);
    const warn = ensureLightness(read(t.warning), 0.78);
    const err = ensureLightness(read(t.error), 0.66);
    setColor(p.ok, ok);
    setColor(p.warn, warn);
    setColor(p.err, err);
    p.probe.copy(p.secondary).lerp(p.text, 0.35);
    this.shared.uGlow.value = Math.min(Math.max(t.holoGlow, 0), 1);
    this.renderer.setClearColor(p.space, 1);
    this.colorStars();

    // For the DOM labels and HUD, which can't lift colours themselves.
    const style = this.wrapper.style;
    style.setProperty('--holo-ok', rgbaToHex(ok));
    style.setProperty('--holo-warn', rgbaToHex(warn));
    style.setProperty('--holo-err', rgbaToHex(err));
    style.setProperty('--holo-halo', `${rgbaToHex({ ...read(t.holoPrimary) })}99`);
    style.setProperty('--holo-veil', `${rgbaToHex(space)}cc`);
    for (const view of this.nodes.values()) this.styleNode(view);
    for (const view of this.moons.values()) this.styleMoon(view);
    for (const view of this.probes.values()) this.styleProbe(view);
    this.invalidate();
  }

  // --- stars and the floor --------------------------------------------------

  private makeStars(): Points<BufferGeometry, ShaderMaterial> {
    const rand = seeded(7);
    const far = 2200;
    const near = 260;
    const count = far + near;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const tint = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      // Uniform on a sphere; the near ones form a sparse shell for parallax.
      const u = rand() * 2 - 1;
      const a = rand() * TAU;
      const r = i < far ? 260 + rand() * 260 : 70 + rand() * 90;
      const s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
      const bright = rand();
      size[i] = i < far ? 0.7 + bright ** 3 * 2.2 : 1 + rand() * 0.8;
      phase[i] = rand();
      tint[i] = rand();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aPhase', new BufferAttribute(phase, 1));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(count * 3), 3));
    g.userData.tint = tint;
    const points = new Points(g, starMaterial(this.shared));
    points.renderOrder = -3;
    points.frustumCulled = false;
    return points;
  }

  /** Mostly pale stars, some leaning to the hologram's two hues; dimmer ones far more common. */
  private colorStars() {
    if (!this.stars) return;
    const g = this.stars.geometry;
    const tint = g.userData.tint as Float32Array;
    const sizes = g.getAttribute('aSize') as BufferAttribute;
    const out = g.getAttribute('aColor') as BufferAttribute;
    const c = new Color();
    for (let i = 0; i < tint.length; i += 1) {
      const t = tint[i];
      c.copy(this.palette.text);
      if (t < 0.22) c.lerp(this.palette.primary, 0.7);
      else if (t < 0.32) c.lerp(this.palette.secondary, 0.6);
      const brightness = Math.min(0.35 + (sizes.getX(i) - 0.7) * 0.4, 1);
      out.setXYZ(i, c.r * brightness, c.g * brightness, c.b * brightness);
    }
    out.needsUpdate = true;
  }

  /** Sizes the floor, the device ring and the camera's limits to the layout. */
  private relayoutWorld() {
    const layout = this.layout!;
    const extent = layout.extent;
    this.gridDrop = Math.max(2.4, extent * 0.11);
    this.grid.position.y = -this.gridDrop;
    this.grid.scale.setScalar(extent * 2.5);
    const gu = this.grid.material.uniforms;
    gu.uRadius.value = 0.5;
    gu.uStep.value = 0.5 / Math.max(Math.round(extent / 2), 4);
    this.probeOrbit.mesh.visible = layout.probes.length > 0;
    this.setRingRadius(this.probeOrbit, layout.probeRadius);
    this.core.visible = layout.nodes.length > 1;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = this.homeDistance() * 1.8;
  }

  // --- camera ---------------------------------------------------------------

  /** Distance at which the whole layout fits the viewport at home elevation. */
  private homeDistance(): number {
    const extent = this.layout?.extent ?? 10;
    const aspect = this.width > 0 && this.height > 0 ? this.width / this.height : 2;
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const tanH = tanV * aspect;
    // The disc spans 2R across; seen from the home elevation it spans
    // 2R sin(elevation) up and down, plus room for labels and drop lines.
    const across = extent / (tanH * 0.9);
    // The device ring is tilted, so it reaches further up and down than the plane.
    const lean = this.layout?.probes.length ? PROBE_TILT * 0.8 : 0;
    const tall = (extent * Math.sin(HOME_ELEVATION + lean) + this.gridDrop * 0.4 + 1) / (tanV * 0.86);
    return Math.max(across, tall, 6);
  }

  /**
   * The home view: the whole system, from the home elevation. Keeps the
   * current azimuth unless `canonical`, so backing out of a node (or a
   * resize while auto-rotating) doesn't swing the view round.
   */
  private homeOffset(canonical = false): Vector3 {
    const d = this.homeDistance();
    const current = this.camera.position.clone().sub(this.controls.target);
    const azimuth = canonical || current.lengthSq() < 1e-6 ? HOME_AZIMUTH : Math.atan2(current.x, current.z);
    return new Vector3(
      Math.cos(HOME_ELEVATION) * Math.sin(azimuth) * d,
      Math.sin(HOME_ELEVATION) * d,
      Math.cos(HOME_ELEVATION) * Math.cos(azimuth) * d,
    );
  }

  private goHome(instant: boolean, canonical = false) {
    this.atHome = true;
    const offset = this.homeOffset(canonical);
    if (instant || this.opts.reducedMotion) {
      this.flight = null;
      this.controls.enabled = true;
      this.controls.target.set(0, 0, 0);
      this.camera.position.copy(offset);
      this.camera.lookAt(this.controls.target);
      this.controls.update();
      this.invalidate();
      return;
    }
    const home = new Vector3(0, 0, 0);
    this.startFlight(() => ({ target: home, offset }), FLIGHT_MS);
  }

  /** The selected body's position, which the camera follows. */
  private focusTarget(): Vector3 | null {
    const key = this.focusState.selected;
    return key ? this.positionOf(key) : null;
  }

  /** Where a node or device is now, in world space. A device's is recomputed, since it rides the tilted ring. */
  private positionOf(key: string): Vector3 | null {
    const node = this.nodes.get(key);
    if (node) return node.group.position;
    const probe = this.probes.get(key);
    return probe ? probe.group.getWorldPosition(this.probeWorld) : null;
  }

  /** How far from a node to frame it with its moons spread out. */
  private nodeDistance(view: NodeView): number {
    const shells = Math.max(view.shells.length, 1);
    const reach = view.radius * MOON_SPREAD + (shells - 1) * SHELL_GAP_SPREAD + 1.2;
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const aspect = this.width > 0 && this.height > 0 ? this.width / this.height : 2;
    return reach / (Math.min(tanV, tanV * aspect) * 0.92);
  }

  /** How far from a device to frame it and its label. */
  private probeDistance(): number {
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const aspect = this.width > 0 && this.height > 0 ? this.width / this.height : 2;
    return (PROBE_SIZE * 5 + 1.2) / (Math.min(tanV, tanV * aspect) * 0.92);
  }

  private flyTo(key: string | null, instant = false, canonical = false) {
    if (!key) {
      this.goHome(instant, canonical);
      return;
    }
    const node = this.nodes.get(key);
    const distance = node ? this.nodeDistance(node) : this.probes.has(key) ? this.probeDistance() : null;
    if (distance === null) return;
    const where = () => this.positionOf(key) ?? this.controls.target;
    this.atHome = false;
    this.lastInput = performance.now();
    const to = () => {
      const target = where();
      // Keep looking from the side we're on, at a comfortable elevation.
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (offset.lengthSq() < 1e-6) offset.copy(this.homeOffset());
      const flat = Math.hypot(offset.x, offset.z) || 1;
      const elevation = Math.min(Math.max(Math.atan2(offset.y, flat), 0.3), 0.75);
      const azimuth = Math.atan2(offset.x, offset.z);
      const d = distance;
      return {
        target,
        offset: new Vector3(
          Math.cos(elevation) * Math.sin(azimuth) * d,
          Math.sin(elevation) * d,
          Math.cos(elevation) * Math.cos(azimuth) * d,
        ),
      };
    };
    if (instant || this.opts.reducedMotion) {
      const end = to();
      this.flight = null;
      this.controls.enabled = true;
      this.controls.target.copy(end.target);
      this.camera.position.copy(end.target).add(end.offset);
      this.followFrom.copy(end.target);
      this.controls.update();
      this.invalidate();
      return;
    }
    // The viewing angle is fixed when the flight starts; the target keeps
    // moving with the body.
    const { offset } = to();
    this.startFlight(() => ({ target: where(), offset }), FLIGHT_MS);
  }

  private startFlight(to: Flight['to'], duration: number) {
    if (this.opts.reducedMotion) duration = 0;
    this.flight = {
      start: performance.now(),
      duration,
      fromTarget: this.controls.target.clone(),
      fromOffset: this.camera.position.clone().sub(this.controls.target),
      to,
    };
    this.controls.enabled = false;
    this.invalidate();
  }

  private stepFlight(now: number) {
    const f = this.flight;
    if (!f) return;
    const t = f.duration > 0 ? Math.min((now - f.start) / f.duration, 1) : 1;
    const k = easeInOut(t);
    const end = f.to();
    const target = this.tmp.copy(f.fromTarget).lerp(end.target, k);
    // Swing the direction and the distance separately, so the camera arcs
    // around rather than cutting through the scene.
    const dir = f.fromOffset.clone().normalize().lerp(end.offset.clone().normalize(), k).normalize();
    const len = f.fromOffset.length() + (end.offset.length() - f.fromOffset.length()) * k;
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, len);
    this.camera.lookAt(target);
    if (t >= 1) {
      this.flight = null;
      this.controls.enabled = true;
      this.followFrom.copy(this.focusTarget() ?? this.controls.target);
    }
  }

  // --- input ----------------------------------------------------------------

  private onControlsStart = () => {
    this.interacting = true;
    this.atHome = false;
    this.lastInput = performance.now();
    this.controls.autoRotate = false;
    this.invalidate();
  };

  private onControlsEnd = () => {
    this.interacting = false;
    this.lastInput = performance.now();
  };

  private onControlsChange = () => {
    // Keep the target near the system, so panning can't lose it.
    const t = this.controls.target;
    const limit = (this.layout?.extent ?? 10) * 1.1;
    const flat = Math.hypot(t.x, t.z);
    if (flat > limit) {
      t.x *= limit / flat;
      t.z *= limit / flat;
    }
    t.y = Math.min(Math.max(t.y, -this.gridDrop), limit * 0.4);
    if (this.opts.reducedMotion) this.invalidate();
  };

  private localPoint(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const { x, y } = this.localPoint(e);
    const key = pick(this.screenBodies(), x, y);
    this.setHover(key);
    this.canvas.style.cursor = key ? 'pointer' : 'grab';
  };

  private onPointerDown = (e: PointerEvent) => {
    const { x, y } = this.localPoint(e);
    this.pointerDown = { x, y, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || e.button !== 0) return;
    const { x, y } = this.localPoint(e);
    // A click, not the end of a drag.
    if (Math.hypot(x - down.x, y - down.y) > 6 || performance.now() - down.t > 700) return;
    const key = pick(this.screenBodies(), x, y, e.pointerType === 'mouse' ? 8 : 16);
    this.dispatch(key ? { type: 'activate', key } : { type: 'empty' });
  };

  private setHover(key: string | null) {
    if (key === this.hovered) return;
    this.hovered = key;
    this.emitFocus();
    this.invalidate();
  }

  private dispatch(intent: Intent) {
    if (!this.layout) return;
    const { state, effect } = interact(this.focusState, this.layout, intent);
    const changed = state.selected !== this.focusState.selected;
    this.focusState = state;
    if (changed) this.labels.sync(this.layout, state.selected);
    if (effect.type === 'fly') this.flyTo(effect.to);
    else if (effect.type === 'open') {
      const body = this.layout.byKey.get(effect.key);
      if (body) this.opts.onOpen(body);
    }
    this.emitFocus();
    this.invalidate();
  }

  private emitFocus() {
    const info: FocusInfo = { selected: this.focusState.selected, hovered: this.hovered, focused: this.focusedLabel };
    const sig = `${info.selected}|${info.hovered}|${info.focused}`;
    if (sig === this.lastFocusInfo) return;
    this.lastFocusInfo = sig;
    this.opts.onFocusChange(info);
  }

  /** Every body's place on screen, for picking. */
  private screenBodies(): ScreenBody[] {
    const out: ScreenBody[] = [];
    const add = (key: string, pos: Vector3, radius: number) => {
      const s = this.toScreen(pos);
      if (s) out.push({ key, x: s.x, y: s.y, r: radius * s.scale, depth: s.depth });
    };
    for (const v of this.nodes.values()) add(v.body.key, v.group.position, v.radius * 1.15);
    for (const v of this.moons.values()) if (v.mesh.visible) add(v.body.key, v.mesh.position, v.size * 1.6);
    for (const v of this.probes.values()) add(v.body.key, v.group.getWorldPosition(this.tmp2), PROBE_SIZE * 1.6);
    return out;
  }

  private readonly projected = new Vector3();

  /** A world point in CSS px, with its camera depth and px per world unit. */
  private toScreen(pos: Vector3): { x: number; y: number; depth: number; scale: number } | null {
    const p = this.projected.copy(pos).applyMatrix4(this.camera.matrixWorldInverse);
    const depth = -p.z;
    if (depth <= this.camera.near) return null;
    p.applyMatrix4(this.camera.projectionMatrix);
    const tanV = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    return {
      x: (p.x * 0.5 + 0.5) * this.width,
      y: (-p.y * 0.5 + 0.5) * this.height,
      depth,
      scale: this.height / 2 / (depth * tanV),
    };
  }

  // --- loop -----------------------------------------------------------------

  private resize(w: number, h: number) {
    if (this.disposed || w < 1 || h < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (w === this.width && h === this.height && dpr === this.renderer.getPixelRatio()) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.shared.uPixelRatio.value = dpr;
    // false: CSS sizes the canvas (absolute, inset 0); only the buffer changes.
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.layout) this.controls.maxDistance = this.homeDistance() * 1.8;
    if (this.atHome && !this.flight) this.goHome(true);
    // Draw now, inside the observer callback: resizing cleared the buffer,
    // and waiting for the next frame is what made it flash.
    this.renderFrame(performance.now());
  }

  private updatePaused() {
    const paused = !this.onScreen || document.visibilityState === 'hidden';
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else {
      this.lastFrame = 0;
      this.invalidate();
    }
  }

  private invalidate() {
    this.dirty = true;
    if (!this.raf && !this.paused && !this.disposed) this.raf = requestAnimationFrame(this.tick);
  }

  /** The camera is being moved by hand or flown, so frames go at full rate. */
  private cameraBusy(now: number): boolean {
    return !!this.flight || this.interacting || now - this.lastInput < 1200;
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.paused || this.disposed) return;
    const busy = this.cameraBusy(now);
    const continuous = !this.opts.reducedMotion || busy;
    if (!this.dirty && !busy && now - this.lastFrame < IDLE_FRAME_MS - 1) {
      if (continuous) this.raf = requestAnimationFrame(this.tick);
      return;
    }
    this.renderFrame(now);
    if (continuous) this.raf = requestAnimationFrame(this.tick);
  };

  private renderFrame(now: number) {
    if (this.lost || this.disposed || !this.width || !this.layout) return;
    const started = performance.now();
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.1) : 0;
    this.lastFrame = now;
    this.dirty = false;
    const motion = this.opts.reducedMotion ? 0 : dt;
    this.simTime += motion;
    this.shared.uTime.value = this.simTime;

    this.simulate(motion, dt);

    // Camera: fly, or follow the selected node and let the controls apply input.
    const followed = this.focusTarget();
    if (this.flight) this.stepFlight(now);
    else {
      if (followed) {
        const delta = this.tmp.copy(followed).sub(this.followFrom);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
      this.controls.autoRotate =
        !this.opts.reducedMotion && !this.focusState.selected && !this.interacting && now - this.lastInput > IDLE_ROTATE_MS;
      this.controls.update(dt);
    }
    if (followed) this.followFrom.copy(followed);

    this.camera.updateMatrixWorld();
    this.updateReticle();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();

    const elapsed = performance.now() - started;
    this.frameTimes.push(elapsed);
    this.frameStamps.push(now);
    while (this.frameStamps.length && now - this.frameStamps[0] > 1000) {
      this.frameStamps.shift();
      this.frameTimes.shift();
    }
  }

  /** Moves everything along its orbit and eases sizes and spreads towards their targets. */
  private simulate(motion: number, dt: number) {
    const selected = this.focusState.selected;
    // Under reduced motion every change lands at once.
    const snap = this.opts.reducedMotion;
    const ease = (from: number, to: number, rate: number) => (snap ? to : approach(from, to, rate, dt));
    for (const view of this.nodes.values()) {
      const b = view.body;
      view.angle += b.speed * motion * (selected === b.key ? 0.35 : 1);
      view.orbitR = ease(view.orbitR, b.orbit, 3);
      view.radius = ease(view.radius, b.radius, 3);
      view.spread = ease(view.spread, selected === b.key ? 1 : 0, 5);
      view.presence = ease(view.presence, selected && selected !== b.key ? 0.45 : 1, 5);

      const x = Math.cos(view.angle) * view.orbitR;
      const z = Math.sin(view.angle) * view.orbitR;
      view.group.position.set(x, 0, z);
      view.group.scale.setScalar(view.radius);
      view.wire.rotation.y += motion * 0.08;

      const online = b.state === 'online';
      // Down nodes are a faint red outline, not a red planet.
      const presence = view.presence * (online ? 1 : 0.42);
      view.shell.material.uniforms.uOpacity.value = presence;
      view.wire.material.uniforms.uOpacity.value = (online ? 0.32 : 0.22) * presence;
      view.core.material.uniforms.uOpacity.value = presence;
      // Bodies are scaled by radius; billboards are sized in world units, so undo it.
      const g = view.glow.material.uniforms;
      g.uSize.value = view.radius * 5;
      g.uIntensity.value = (online ? 0.35 + view.cpu * 0.45 : 0.08) * view.presence;
      const gauge = view.gauge.material.uniforms;
      gauge.uSize.value = 2 * 1.45 * view.radius;
      gauge.uCpu.value = ease(gauge.uCpu.value, view.cpu, 4);
      gauge.uMem.value = ease(gauge.uMem.value, view.mem, 4);
      gauge.uOpacity.value = view.presence;
      this.styleGauge(view);

      // Orbit with a comet tail behind the node; nothing for a lone centre node.
      view.orbit.mesh.visible = view.orbitR > 0.5;
      this.setRingRadius(view.orbit, Math.max(view.orbitR, 0.01));
      const ou = view.orbit.mesh.material.uniforms;
      ou.uHead.value = (((view.angle / TAU) % 1) + 1) % 1;
      ou.uOpacity.value = 0.5 * (selected && selected !== b.key ? 0.5 : 1);

      // Drop line and footprint on the floor below.
      const drop = view.drop.geometry.getAttribute('position') as BufferAttribute;
      drop.setXYZ(0, x, -view.radius, z);
      drop.setXYZ(1, x, -this.gridDrop, z);
      drop.needsUpdate = true;
      view.foot.mesh.position.set(x, -this.gridDrop + 0.01, z);
      this.setRingRadius(view.foot, view.radius * 0.9);
      view.foot.mesh.material.uniforms.uOpacity.value = 0.45 * view.presence;

      // A faint link to the core while the node is reachable.
      const link = view.link.geometry.getAttribute('position') as BufferAttribute;
      const toCore = this.tmp.set(-x, 0, -z);
      const len = toCore.length();
      if (len > 0.01) toCore.multiplyScalar((len - view.radius) / len);
      link.setXYZ(0, x + toCore.x, 0, z + toCore.z);
      link.setXYZ(1, 0, 0, 0);
      link.needsUpdate = true;
      view.link.visible = online && view.orbitR > 0.5 && this.nodes.size > 1;

      // Moon shells.
      view.shells.forEach((s, i) => {
        s.angle += s.speed * motion * (1 - view.spread * 0.85);
        const r = view.radius * (MOON_BASE + (MOON_SPREAD - MOON_BASE) * view.spread) + i * (SHELL_GAP + (SHELL_GAP_SPREAD - SHELL_GAP) * view.spread);
        // Rings live inside the scaled group, so radius and width are in body radii.
        s.ring.width = 0.025 + view.spread * 0.015;
        this.setRingRadius(s.ring, r / view.radius);
        s.ring.mesh.material.uniforms.uOpacity.value = (0.2 + view.spread * 0.25) * view.presence;
      });
    }

    for (const view of this.moons.values()) {
      const node = this.nodes.get(view.body.nodeKey);
      if (!node) continue;
      const shell = node.shells[view.body.shell];
      if (!shell) continue;
      view.slot = snap ? view.body.slot : approachTurn(view.slot, view.body.slot, 3, dt);
      const a = view.slot * TAU + shell.angle;
      const r = node.radius * (MOON_BASE + (MOON_SPREAD - MOON_BASE) * node.spread) + view.body.shell * (SHELL_GAP + (SHELL_GAP_SPREAD - SHELL_GAP) * node.spread);
      const local = this.tmp.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(shell.tilt);
      view.mesh.position.copy(node.group.position).add(local);
      view.size = 0.19 + node.spread * 0.07;
      view.mesh.scale.setScalar(view.size);
      const presence = node.presence * (view.body.state === 'stopped' ? 0.5 : 1);
      view.mesh.material.uniforms.uOpacity.value = presence;
      if (view.halo) {
        view.halo.position.copy(view.mesh.position);
        view.halo.material.uniforms.uIntensity.value = 0.8 * presence;
      }
    }

    // A focused device slows its ring, as a focused node slows its orbit.
    this.probeAngle += motion * 0.012 * (selected && this.probes.has(selected) ? 0.35 : 1);
    const probeR = this.layout!.probeRadius;
    for (const view of this.probes.values()) {
      view.slot = snap ? view.body.slot : approachTurn(view.slot, view.body.slot, 2, dt);
      const a = view.slot * TAU + this.probeAngle;
      view.group.position.set(Math.cos(a) * probeR, 0, Math.sin(a) * probeR);
      view.group.rotation.y += motion * 0.5;
      view.group.rotation.x += motion * 0.21;
      view.pulse?.position.copy(view.group.position);
    }
    const dim = selected ? 0.5 : 1;
    this.probeOrbit.mesh.material.uniforms.uOpacity.value = 0.4 * dim;

    this.core.rotation.y += motion * 0.15;
    this.coreRings[1]?.mesh.rotation.set(Math.PI / 2, 0, -this.simTime * 0.3);
  }

  private updateReticle() {
    const key = this.focusedLabel ?? this.hovered ?? this.focusState.selected;
    const u = this.reticle.material.uniforms;
    if (!key) {
      u.uOpacity.value = 0;
      this.reticle.visible = false;
      return;
    }
    let pos: Vector3 | null = null;
    let size = 1;
    const node = this.nodes.get(key);
    const moon = this.moons.get(key);
    const probe = this.probes.get(key);
    if (node) {
      pos = node.group.position;
      size = node.radius * 3.4;
    } else if (moon) {
      pos = moon.mesh.position;
      size = Math.max(moon.size * 5, 0.9);
    } else if (probe) {
      pos = probe.group.getWorldPosition(this.tmp2);
      size = PROBE_SIZE * 4.5;
    }
    this.reticle.visible = !!pos;
    if (!pos) return;
    this.reticle.position.copy(pos);
    u.uSize.value = size;
    u.uOpacity.value = key === this.focusState.selected && !this.focusedLabel && !this.hovered ? 0.5 : 0.95;
  }

  /** Positions every visible label over its body. */
  private placeLabels() {
    const selected = this.focusState.selected;
    const focused = this.focusedLabel;
    // Rough label boxes, to keep moon names from piling on top of each other.
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !taken.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
    const textWidth = (text: string, px: number) => text.length * px + 14;

    for (const view of this.nodes.values()) {
      const s = this.toScreen(view.group.position);
      const key = view.body.key;
      if (!s || !this.onCanvas(s.x, s.y, 80)) {
        this.labels.hide(key);
        continue;
      }
      // Below the gauge.
      const y = s.y + view.radius * 1.5 * s.scale + 2;
      const w = textWidth(view.body.name, 8);
      taken.push({ x0: s.x - w / 2, y0: y, x1: s.x + w / 2, y1: y + 28 });
      this.labels.place(key, s.x, y, s.depth);
    }

    const moons: { key: string; x: number; y: number; depth: number; name: string; forced: boolean }[] = [];
    for (const view of this.moons.values()) {
      const key = view.body.key;
      const forced = key === this.hovered || key === focused;
      const s = forced || view.body.nodeKey === selected ? this.toScreen(view.mesh.position) : null;
      if (!s || !this.onCanvas(s.x, s.y, 40)) {
        this.labels.hide(key);
        continue;
      }
      moons.push({ key, x: s.x + view.size * s.scale, y: s.y, depth: s.depth, name: view.body.name, forced });
    }
    // The one being pointed at first, then nearest first.
    moons.sort((a, b) => Number(b.forced) - Number(a.forced) || a.depth - b.depth);
    for (const m of moons) {
      const box = { x0: m.x, y0: m.y - 8, x1: m.x + textWidth(m.name, 6.4), y1: m.y + 8 };
      if (!m.forced && !free(box.x0, box.y0, box.x1, box.y1)) {
        this.labels.hide(m.key);
        continue;
      }
      taken.push(box);
      this.labels.place(m.key, m.x, m.y, m.depth);
    }

    for (const view of this.probes.values()) {
      const key = view.body.key;
      const s = this.toScreen(view.group.getWorldPosition(this.tmp2));
      if (!s || !this.onCanvas(s.x, s.y, 40)) {
        this.labels.hide(key);
        continue;
      }
      const y = s.y + PROBE_SIZE * 1.2 * s.scale;
      const w = textWidth(view.body.name, 6.4);
      const forced = key === this.hovered || key === focused;
      if (!forced && !free(s.x - w / 2, y + 4, s.x + w / 2, y + 20)) {
        this.labels.hide(key);
        continue;
      }
      taken.push({ x0: s.x - w / 2, y0: y + 4, x1: s.x + w / 2, y1: y + 20 });
      this.labels.place(key, s.x, y, s.depth);
    }
  }

  private onCanvas(x: number, y: number, margin: number): boolean {
    return x > -margin && y > -margin && x < this.width + margin && y < this.height + margin;
  }
}
