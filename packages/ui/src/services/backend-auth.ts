let cookieReady: Promise<void> | null = null;

export function ensureBackendCookie(): Promise<void> {
  if (!cookieReady) {
    cookieReady = fetch('/api/health', { credentials: 'same-origin' })
      .then(() => undefined)
      .catch(() => undefined);
  }
  return cookieReady;
}

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  await ensureBackendCookie();
  return fetch(input, {
    credentials: 'same-origin',
    ...init,
    headers: init.headers,
  });
}
