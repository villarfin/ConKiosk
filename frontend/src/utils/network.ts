export async function timedFetch(url: string, options: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15000, ...init } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}
