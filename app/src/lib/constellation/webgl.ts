let supported: boolean | null = null;

/**
 * Whether this browser can make a WebGL 2 context. Asked once; the probe's
 * context is released at once, since browsers cap how many are alive.
 */
export function hasWebGL(): boolean {
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    supported = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}
