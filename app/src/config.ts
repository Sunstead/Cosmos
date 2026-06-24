import { isTauri } from "@tauri-apps/api/core";
import { NodeConfig } from "./stores/nodes";

export async function getDefaultNodes(): Promise<NodeConfig[]> {
  if (isTauri()) {
    return []; // On desktop: no default, user adds manually
  }
  try {
    const res = await fetch("/config.json");
    return await res.json();
  } catch {
    return [];
  }
}