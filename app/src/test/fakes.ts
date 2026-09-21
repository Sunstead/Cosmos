/**
 * Controllable stand-ins for the browser streaming APIs.
 */

type Listener = (e: MessageEvent) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onmessage: Listener | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  private named = new Map<string, Set<Listener>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener) {
    if (!this.named.has(type)) this.named.set(type, new Set());
    this.named.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Listener) {
    this.named.get(type)?.delete(fn);
  }

  /** Delivers an unnamed event, as the agent sends them. */
  emit(data: unknown) {
    this.readyState = FakeEventSource.OPEN;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  /** Delivers a named event, which `onmessage` never sees. */
  emitNamed(type: string, data: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) });
    this.named.get(type)?.forEach((fn) => fn(e));
  }

  fail(closed = true) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  static latest(match: string) {
    return [...FakeEventSource.instances].reverse().find((s) => s.url.includes(match));
  }
}

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  send(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

/** Minimal JSON fetch router keyed by path suffix. */
export function mockFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const route = routes[path];
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/** Lets pending fetch/json promise chains settle. */
export async function settle(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) await new Promise((r) => setTimeout(r, 0));
}
