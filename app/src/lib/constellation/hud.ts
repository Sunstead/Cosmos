/**
 * Labels over the scene, as real DOM buttons: crisp text in the app's fonts
 * and tokens, and the keyboard and screen reader path into the map. Tab
 * walks the nodes (and the focused node's moons), arrows walk everything
 * including devices, Enter or a click activates, Escape backs out, + and -
 * zoom. The scene positions the buttons every frame it draws.
 */
import { Body, describe, focusOrder, Layout } from './model';

export interface LabelHandlers {
  activate(key: string): void;
  /** Keyboard focus moved onto a label, or out of the map (null). */
  focus(key: string | null): void;
  hover(key: string | null): void;
  back(): boolean;
  zoom(direction: 1 | -1): void;
  step(from: string | null, delta: 1 | -1): string | null;
}

interface Label {
  el: HTMLButtonElement;
  sub: HTMLSpanElement | null;
  kind: Body['kind'];
  x: number;
  y: number;
  z: number;
  /** Measured size, for whole-pixel anchoring; null when the text changed. */
  size: { w: number; h: number } | null;
  shown: boolean;
  text: string;
  subText: string;
  tone: string;
}

// Type, case and glow depend on the theme's style: see .sky-label in App.css.
const BASE =
  'sky-label group pointer-events-auto absolute top-0 left-0 flex select-none items-center gap-1 whitespace-nowrap rounded-sm ' +
  'px-1 py-px leading-tight outline-none text-[var(--holo-text)] ' +
  'focus-visible:bg-[var(--holo-veil)] focus-visible:ring-1 focus-visible:ring-[var(--holo-primary)]';

const KIND_CLASS: Record<Body['kind'], string> = {
  node: 'flex-col gap-0 text-xs',
  moon: 'text-2xs',
  probe: 'text-2xs text-[var(--holo-dim)] hover:text-[var(--holo-text)] focus-visible:text-[var(--holo-text)]',
};

/**
 * Where a label sits relative to its body's screen point, from its measured
 * size; the total is snapped to device pixels in `place`. Not
 * `translate(-50%)`: half a pixel off the grid is what blurred the CPU line
 * under a node.
 */
const ANCHOR: Record<Body['kind'], (w: number, h: number) => [number, number]> = {
  node: (w) => [-w / 2, 0],
  moon: (_, h) => [10, -h / 2],
  probe: (w) => [-w / 2, 8],
};

export class LabelLayer {
  private labels = new Map<string, Label>();
  /** Device pixels per CSS pixel: labels land on the screen's own grid. */
  private dpr = 1;
  private order = '';
  private disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: LabelHandlers,
  ) {
    root.addEventListener('click', this.onClick);
    root.addEventListener('keydown', this.onKey);
    root.addEventListener('focusin', this.onFocusIn);
    root.addEventListener('focusout', this.onFocusOut);
    root.addEventListener('pointerover', this.onPointerOver);
    root.addEventListener('pointerout', this.onPointerOut);
  }

  /** Creates, updates and removes labels to match the layout. */
  sync(layout: Layout, selected: string | null) {
    for (const [key, label] of this.labels) {
      if (layout.byKey.has(key)) continue;
      label.el.remove();
      this.labels.delete(key);
    }
    for (const body of layout.byKey.values()) {
      let label = this.labels.get(body.key);
      if (!label) label = this.create(body);
      if (label.text !== body.name) {
        label.text = body.name;
        (label.el.firstChild as HTMLElement).textContent = body.name;
        label.size = null;
      }
      label.el.setAttribute('aria-label', describe(body));
      const tone = toneOf(body);
      if (tone !== label.tone) {
        label.tone = tone;
        label.el.dataset.tone = tone;
      }
    }

    // DOM order is Tab order: each node, then its moons, then devices.
    // Only re-appended when it changed; moving an element drops its focus.
    const keys = [...layout.nodes.flatMap((n) => [n.key, ...n.moonKeys]), ...layout.probes.map((p) => p.key)];
    const order = keys.join('\n');
    if (order !== this.order) {
      this.order = order;
      for (const key of keys) this.root.append(this.labels.get(key)!.el);
    }

    const tabbable = new Set(focusOrder(layout, selected));
    for (const [key, label] of this.labels) {
      // Devices are reached with the arrow keys, so Tab doesn't wade through every phone.
      label.el.tabIndex = tabbable.has(key) && label.kind !== 'probe' ? 0 : -1;
    }
  }

  /** A second line under a node's name: its CPU, or why it's not there. */
  setSub(key: string, text: string) {
    const label = this.labels.get(key);
    if (!label?.sub || label.subText === text) return;
    label.subText = text;
    label.sub.textContent = text;
    label.size = null;
  }

  setPixelRatio(dpr: number) {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    for (const label of this.labels.values()) label.x = NaN;
  }

  /** Shows a label at a screen point; `z` orders overlapping labels nearest first. */
  place(key: string, x: number, y: number, z: number) {
    const label = this.labels.get(key);
    if (!label) return;
    if (!label.shown) {
      label.shown = true;
      label.el.hidden = false;
    }
    // Measured once per text change; a layout read, but not every frame.
    let moved = false;
    if (!label.size) {
      label.size = { w: label.el.offsetWidth, h: label.el.offsetHeight };
      moved = true;
    }
    // Snapped to device pixels, not CSS ones: crisp text that still moves
    // in the screen's finest steps (whole CSS pixels jumped 2-3 at a time).
    const [dx, dy] = ANCHOR[label.kind](label.size.w, label.size.h);
    const snap = (v: number) => Math.round(v * this.dpr) / this.dpr;
    const px = snap(x + dx);
    const py = snap(y + dy);
    if (moved || px !== label.x || py !== label.y) {
      label.x = px;
      label.y = py;
      label.el.style.transform = `translate(${px}px, ${py}px)`;
    }
    const zi = Math.round(10_000 - z * 10);
    if (zi !== label.z) {
      label.z = zi;
      label.el.style.zIndex = String(zi);
    }
  }

  hide(key: string) {
    const label = this.labels.get(key);
    if (!label?.shown) return;
    // Never hide the label that has focus: the keyboard would lose its place.
    if (label.el === document.activeElement) return;
    label.shown = false;
    label.el.hidden = true;
  }

  isShown(key: string): boolean {
    return this.labels.get(key)?.shown ?? false;
  }

  focus(key: string) {
    const label = this.labels.get(key);
    if (!label) return;
    if (!label.shown) {
      label.shown = true;
      label.el.hidden = false;
    }
    label.el.focus({ preventScroll: true });
  }

  /** The label with keyboard focus, if any. */
  focused(): string | null {
    const el = document.activeElement;
    return el instanceof HTMLElement && this.root.contains(el) ? (el.dataset.key ?? null) : null;
  }

  dispose() {
    this.disposed = true;
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('keydown', this.onKey);
    this.root.removeEventListener('focusin', this.onFocusIn);
    this.root.removeEventListener('focusout', this.onFocusOut);
    this.root.removeEventListener('pointerover', this.onPointerOver);
    this.root.removeEventListener('pointerout', this.onPointerOut);
    for (const label of this.labels.values()) label.el.remove();
    this.labels.clear();
  }

  private create(body: Body): Label {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.key = body.key;
    el.dataset.kind = body.kind;
    el.className = `${BASE} ${KIND_CLASS[body.kind]}`;
    el.hidden = true;
    const name = document.createElement('span');
    name.className = 'max-w-48 truncate';
    el.append(name);
    let sub: HTMLSpanElement | null = null;
    if (body.kind === 'node') {
      sub = document.createElement('span');
      sub.className = 'sky-sub text-2xs group-data-[tone=err]:text-[var(--holo-err)]';
      sub.setAttribute('aria-hidden', 'true');
      el.append(sub);
    } else {
      // A status dot, coloured by the label's tone.
      const dot = document.createElement('span');
      dot.setAttribute('aria-hidden', 'true');
      dot.className =
        'order-first size-1.5 shrink-0 rounded-full bg-[var(--holo-secondary)] ' +
        'group-data-[tone=warn]:bg-[var(--holo-warn)] group-data-[tone=err]:bg-[var(--holo-err)] group-data-[tone=dim]:bg-[var(--holo-dim)]';
      el.append(dot);
    }
    const label: Label = {
      el,
      sub,
      kind: body.kind,
      x: NaN,
      y: NaN,
      z: NaN,
      size: null,
      shown: false,
      text: '',
      subText: '',
      tone: '',
    };
    this.labels.set(body.key, label);
    this.root.append(el);
    return label;
  }

  private keyOf(target: EventTarget | null): string | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-key]') : null;
    return el && this.root.contains(el) ? (el.dataset.key ?? null) : null;
  }

  private onClick = (e: MouseEvent) => {
    const key = this.keyOf(e.target);
    if (key) this.handlers.activate(key);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const current = this.keyOf(e.target);
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp': {
        e.preventDefault();
        const next = this.handlers.step(current, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
        if (next) this.focus(next);
        break;
      }
      case 'Escape':
        if (this.handlers.back()) {
          e.preventDefault();
          e.stopPropagation();
        }
        break;
      case '+':
      case '=':
        e.preventDefault();
        this.handlers.zoom(1);
        break;
      case '-':
      case '_':
        e.preventDefault();
        this.handlers.zoom(-1);
        break;
    }
  };

  private onFocusIn = (e: FocusEvent) => {
    this.handlers.focus(this.keyOf(e.target));
  };

  private onFocusOut = (e: FocusEvent) => {
    // Moving between labels fires focusin next; only leaving the map clears.
    if (this.disposed || (e.relatedTarget instanceof Node && this.root.contains(e.relatedTarget))) return;
    this.handlers.focus(null);
  };

  private onPointerOver = (e: PointerEvent) => {
    const key = this.keyOf(e.target);
    if (key) this.handlers.hover(key);
  };

  private onPointerOut = (e: PointerEvent) => {
    if (this.keyOf(e.target) && !this.keyOf(e.relatedTarget)) this.handlers.hover(null);
  };
}

/** Which colour a label's status takes; matches the scene's. */
export function toneOf(body: Body): 'ok' | 'warn' | 'err' | 'dim' {
  switch (body.kind) {
    case 'node':
      return body.state === 'online' ? 'ok' : body.state === 'connecting' ? 'dim' : 'err';
    case 'moon':
      return body.state === 'ok' ? 'ok' : body.state === 'partial' ? 'warn' : body.state === 'down' ? 'err' : 'dim';
    case 'probe':
      return body.wol === 'waking' ? 'warn' : body.online ? 'ok' : 'dim';
  }
}
