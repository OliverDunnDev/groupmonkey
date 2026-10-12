// Base URL is empty in the browser (Vite proxies /api). A desktop shell can set VITE_API_URL.
const BASE: string = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'groupmonkey.token'

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* storage unavailable: session-only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* ignore */
    }
  },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'groupmonkey:unauthorized'

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get()
  let status: number
  let data: unknown

  if (__DEMO__) {
    // Static demo: the whole API runs in the browser (see src/demo). The import is dead-code eliminated from normal builds.
    const { handle } = await import('../demo/server')
    const res = await handle(init.method ?? 'GET', path, init.body, token)
    status = res.status
    data = res.data
  } else {
    let res: Response
    try {
      res = await fetch(`${BASE}/api${path}`, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      })
    } catch {
      throw new ApiError(0, 'Cannot reach the API. Is it running? (dotnet run --project src/GroupMonkey.Api)')
    }
    status = res.status
    try {
      data = status === 204 ? undefined : await res.json()
    } catch {
      data = undefined // no body
    }
  }

  if (status === 401 && !path.startsWith('/auth/login')) {
    tokenStore.clear()
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  if (status >= 400) {
    let message = 'Request failed'
    const error = (data as { error?: string } | undefined)?.error
    if (error) message = error
    if (status === 403) message = "You don't have permission to do that."
    throw new ApiError(status, message)
  }
  return data as T
}
