import { ContainersResponse } from '@/generated/ContainersResponse';
import { HostInfo } from '@/generated/HostInfo';

export class AgentClient {
  constructor(private baseUrl: string) {}

  async getHost(): Promise<HostInfo> {
    const res = await fetch(`${this.baseUrl}/v1/host`);
    if (!res.ok) throw new Error(`Failed to fetch host: ${res.status}`);
    return res.json();
  }

  streamHost(
    onData: (data: HostInfo) => void,
    onError?: () => void,
  ): () => void {
    const source = new EventSource(`${this.baseUrl}/v1/host/stream`);
    source.onmessage = (e) => {
      try {
        onData(JSON.parse(e.data) as HostInfo);
      } catch {}
    };
    if (onError) source.onerror = onError;
    return () => source.close();
  }

  async getContainers(): Promise<ContainersResponse> {
    const res = await fetch(`${this.baseUrl}/v1/containers`);
    if (!res.ok) throw new Error(`Failed to fetch containers: ${res.status}`);
    return res.json();
  }
}
