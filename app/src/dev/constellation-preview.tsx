/**
 * Dev only: the constellation on fixture data, at `/e2e/constellation.html`
 * on the Vite dev server. Not part of the build (only index.html is an
 * entry). Used to judge the look with a full sky and to measure frame time.
 *
 * Query: `theme=<id>` (or `light`/`dark` for the Cosmos themes), `nodes`,
 * `moons`, `probes`, `variant=card|full`.
 */
import ReactDOM from 'react-dom/client';
import { hostInfo } from '@/test/fixtures';
import { ConstellationView } from '@/components/constellation-view';
import { HostHub, ConstellationSource } from '@/lib/constellation/source';
import { MoonInput, NodeInput, ProbeInput, Snapshot } from '@/lib/constellation/model';
import { applyTheme, DEFAULT_THEME, themeById } from '@/lib/themes';
import '@/App.css';

const q = new URLSearchParams(location.search);
const themeParam = q.get('theme');
applyTheme(
  themeById(
    themeParam === 'light' || themeParam === 'dark' ? `cosmos-${themeParam}` : themeParam,
  ) ?? themeById(DEFAULT_THEME)!,
);
const nodeCount = Number(q.get('nodes') ?? 5);
const moonCount = Number(q.get('moons') ?? 50);
const probeCount = Number(q.get('probes') ?? 15);
const variant = q.get('variant') === 'card' ? 'card' : 'full';

const NODE_NAMES = [
  'jupiter',
  'saturn',
  'mars',
  'europa',
  'titan',
  'io',
  'vesta',
  'ceres',
];
const SERVICES = [
  'Immich',
  'Jellyfin',
  'Nextcloud',
  'Gitea',
  'Home Assistant',
  'Grafana',
  'Prometheus',
  'Vaultwarden',
  'Paperless',
  'Authentik',
  'Caddy',
  'Pi-hole',
  'Syncthing',
  'Plex',
  'Sonarr',
  'Radarr',
  'Prowlarr',
  'Uptime Kuma',
  'Mealie',
  'Miniflux',
  'Linkding',
  'Audiobookshelf',
  'Navidrome',
  'Frigate',
  'Mosquitto',
  'Zigbee2MQTT',
  'Node-RED',
  'InfluxDB',
  'Loki',
  'Opencloud',
  'Stirling PDF',
  'Actual',
  'Homepage',
  'Tandoor',
  'Wallabag',
  'FreshRSS',
  'Kavita',
  'Calibre',
  'Code Server',
  'Woodpecker',
  'Registry',
  'MinIO',
  'Restic',
  'Traefik',
  'Postgres',
  'Redis',
  'Ollama',
  'Open WebUI',
  'Whisper',
  'Piper',
];
const DEVICES: [string, string][] = [
  ['iphone', 'iOS'],
  ['ipad', 'iOS'],
  ['macbook', 'macOS'],
  ['desktop', 'windows'],
  ['pixel', 'android'],
  ['nas', 'linux'],
  ['printer-pi', 'linux'],
  ['tv', 'android'],
  ['studio', 'macOS'],
  ['router', 'linux'],
  ['work-laptop', 'windows'],
  ['watch', 'iOS'],
  ['steamdeck', 'linux'],
  ['camera-hub', 'other'],
  ['kindle', 'other'],
];

const memories = [64, 16, 8, 32, 4, 2, 128, 16].map((g) => g * 1024 ** 3);
const nodes: NodeInput[] = Array.from({ length: nodeCount }, (_, i) => ({
  id: `n${i}`,
  name: NODE_NAMES[i % NODE_NAMES.length],
  state: i === 3 ? 'offline' : 'online',
  memBytes: memories[i % memories.length],
}));
// More services on the bigger hosts, as in a real homelab.
const weights = nodes.map((_, i) => [5, 3, 2, 1, 1][i % 5]);
const total = weights.reduce((a, b) => a + b, 0);
const moons: MoonInput[] = [];
let s = 0;
nodes.forEach((n, i) => {
  const count =
    i === nodes.length - 1 ? moonCount - s : Math.round((moonCount * weights[i]) / total);
  for (let j = 0; j < count && s < moonCount; j += 1, s += 1) {
    const name = SERVICES[s % SERVICES.length];
    moons.push({
      nodeId: n.id,
      service: `${name.toLowerCase().replace(/\W+/g, '-')}-${s}`,
      name,
      state:
        s === 4
          ? 'down'
          : s === 9
            ? 'partial'
            : s === 13 || n.state === 'offline'
              ? 'stopped'
              : 'ok',
      url: s % 3 ? `${name.toLowerCase().replace(/\W+/g, '')}.example.net` : null,
    });
  }
});
const probes: ProbeInput[] = Array.from({ length: probeCount }, (_, i) => {
  const [name, os] = DEVICES[i % DEVICES.length];
  return {
    id: `d${i}`,
    name: i < DEVICES.length ? name : `${name}-${i}`,
    os,
    online: i % 4 !== 3,
    wol: i === 3 ? 'waking' : i === 7 ? 'asleep' : null,
  };
});
const snapshot: Snapshot = { nodes, moons, probes };

const hub = new HostHub();
const source: ConstellationSource = {
  snapshot: () => snapshot,
  subscribe: () => () => {},
  onHost: (id, fn) => hub.on(id, fn),
};

let tick = 0;
const sample = () => {
  tick += 1;
  nodes.forEach((n, i) => {
    if (n.state !== 'online') return;
    const mem = n.memBytes!;
    hub.push(
      n.id,
      hostInfo({
        name: n.name,
        mem_total_bytes: mem,
        mem_used_bytes: mem * (0.35 + 0.1 * i + 0.05 * Math.sin(tick / 4 + i)),
        cpu_pct: [38, 86, 12, 0, 97][i % 5] + 4 * Math.sin(tick / 2 + i),
        disk: [
          {
            mount: '/',
            label: '/',
            used_bytes: 600e9 + i * 1e11,
            total_bytes: 1e12,
            read_bps: 2e6,
            write_bps: 1e6,
            kind: 'ssd',
          },
        ],
        net_rx_bps: 2.4e6 * (i + 1),
        net_tx_bps: 0.6e6 * (i + 1),
      }),
    );
  });
};
sample();
setInterval(sample, 1000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <div className='h-screen w-screen bg-background p-4'>
    <ConstellationView
      source={source}
      variant={variant}
      className={
        variant === 'card'
          ? 'aspect-[2/1] max-h-[28rem] w-full rounded-xl border'
          : 'size-full rounded-xl border'
      }
      onOpen={(body) => console.info('open', body.key)}
      onExpand={variant === 'card' ? () => {} : undefined}
      onUnsupported={() => console.error('webgl unsupported')}
    />
  </div>,
);
