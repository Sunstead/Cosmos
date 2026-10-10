import { describe, expect, it } from 'vitest';
import { formatDuration, parseStructured } from './structured-log';

const AUTHENTIK =
  '{"filename":"packages/ak-axum/src/tracing.rs","level":"info","line_number":48,"pid":7,"spans":[{"host":"localhost","method":"GET","name":"request","path":"/-/health/live/","remote":"::1","scheme":"http"}],"target":"authentik_axum::tracing","thread_id":"ThreadId(31)","thread_name":"tokio-29","timestamp":"2026-10-10T20:08:20.388162","event":"/-/health/live/","runtime":"0","status":200,"host":"localhost","http_headers":"{\\"user_agent\\": \\"goauthentik.io/healthcheck\\"}","method":"GET","name":"request","path":"/-/health/live/","remote":"::1","scheme":"http"}';

const OPENCLOUD =
  '{"level":"info","service":"proxy","proto":"HTTP/1.1","request-id":"75f2f9e1","traceid":"18da7e60","remote-addr":"192.0.2.16","method":"GET","status":200,"path":"/graph/v1.0/me/drives","duration":9.348012,"bytes":1262,"time":"2026-10-10T20:08:18Z","line":"github.com/opencloud-eu/opencloud/services/proxy/pkg/middleware/accesslog.go:34","message":"access-log"}';

const CADDY =
  '{"level":"error","ts":1760126898.1,"logger":"http.log.access","msg":"handled request","request":{"remote_ip":"192.0.2.1","proto":"HTTP/2.0","method":"POST","host":"example.test","uri":"/api/upload","headers":{}},"bytes_read":0,"user_id":"","duration":1.25,"size":12,"status":502,"resp_headers":{"Server":["Caddy"]}}';

describe('parseStructured', () => {
  it('reads an Authentik request as the request, without the source location', () => {
    const log = parseStructured(AUTHENTIK)!;
    expect(log.level).toBeNull();
    expect(log.message).toBe('GET /-/health/live/ 200 0ms');
    const keys = log.fields.map(([k]) => k);
    expect(keys).not.toContain('filename');
    expect(keys).not.toContain('spans');
    expect(keys).not.toContain('timestamp');
    expect(keys).not.toContain('event');
    expect(keys).toContain('remote');
    expect(log.fields).toContainEqual(['http_headers', '"{\\"user_agent\\": \\"goauthentik.io/healthcheck\\"}"']);
  });

  it('turns OpenCloud\'s "access-log" into what was accessed', () => {
    const log = parseStructured(OPENCLOUD)!;
    expect(log.message).toBe('GET /graph/v1.0/me/drives 200 9ms');
    expect(log.fields.slice(0, 2)).toEqual([
      ['service', 'proxy'],
      ['proto', 'HTTP/1.1'],
    ]);
    expect(log.fields).toContainEqual(['message', 'access-log']);
    expect(log.fields.map(([k]) => k)).not.toContain('line');
  });

  it('reads Caddy\'s nested request, in seconds', () => {
    const log = parseStructured(CADDY)!;
    expect(log.level).toBe('error');
    expect(log.message).toBe('POST /api/upload 502 1.3s');
    expect(log.fields).toContainEqual(['msg', '"handled request"']);
    expect(log.fields).toContainEqual(['resp_headers', '{…}']);
    expect(log.fields.map(([k]) => k)).not.toContain('user_id');
  });

  it('leads with the message of a plain structured line', () => {
    const log = parseStructured('{"time":"x","level":"WARN","msg":"slow query","ms":812}')!;
    expect(log.level).toBe('warn');
    expect(log.message).toBe('slow query');
    expect(log.fields).toEqual([['ms', '812']]);
  });

  it('takes the top-level level, not one nested deeper', () => {
    const log = parseStructured('{"ctx":{"level":"error"},"level":"info","msg":"ok"}')!;
    expect(log.level).toBeNull();
  });

  it('understands numeric levels', () => {
    expect(parseStructured('{"level":50,"msg":"x"}')!.level).toBe('error');
    expect(parseStructured('{"level":40,"msg":"x"}')!.level).toBe('warn');
    expect(parseStructured('{"level":30,"msg":"x"}')!.level).toBeNull();
  });

  it('leaves everything that is not a JSON object alone', () => {
    expect(parseStructured('plain text')).toBeNull();
    expect(parseStructured('[1, 2]')).toBeNull();
    expect(parseStructured('{"broken": ')).toBeNull();
    expect(parseStructured('{not json}')).toBeNull();
    expect(parseStructured('level=info msg=x')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('reads like people write it', () => {
    expect(formatDuration(0.42)).toBe('0.4ms');
    expect(formatDuration(9.348)).toBe('9ms');
    expect(formatDuration(1250)).toBe('1.3s');
  });
});
