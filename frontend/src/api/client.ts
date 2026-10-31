import type { Session, LoginInput, RegisterInput, User, Csrf, Error as ErrorEnvelope } from './schema.ts'

export class ApiError extends Error {
  status: number
  code: string
  requestId?: string
  fields: Array<{ path: string; code: string; message: string }>
  constructor(status: number, code: string, message: string, details?: ErrorEnvelope['error']) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = details?.request_id
    this.fields = Array.isArray(details?.fields) ? details.fields : []
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.'
  if (error.status === 501) return 'This backend feature is not implemented yet. No live records are available.'
  if (error.status === 401) return 'Sign in again to continue. Your session may have expired.'
  if (error.status === 403) return error.code === 'CSRF_INVALID'
    ? 'Your security token expired. Refresh the session before trying again.'
    : 'Your account does not have permission to perform this action.'
  if (error.status === 412) return 'This record changed. Refresh it before submitting a new action.'
  if (error.code === 'NETWORK_ERROR') return 'Cannot reach the backend. Check that it is running and try again.'
  if (error.code === 'TIMEOUT') return 'The backend did not respond in time. Please try again.'
  if (error.status === 429) return 'Too many requests. Wait a moment before trying again.'
  return error.message
}

export type Query = Record<string, string | number | boolean | undefined>
export interface PreparedMutation {
  readonly path: string
  readonly method: 'POST' | 'PATCH'
  readonly body: string
  readonly key: string
  readonly version?: number
}

// No bearer tokens or session credentials in localStorage. Cookies are managed by the browser.
export class ApiClient {
  private csrfToken: string | undefined
  private csrfPending: Promise<string> | undefined
  private transport: typeof fetch
  private timeoutMs: number

  constructor(transport: typeof fetch = (...args) => fetch(...args), timeoutMs = 10_000) {
    this.transport = transport
    this.timeoutMs = timeoutMs
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.transport(path, { ...options, credentials: 'include', signal })
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ApiError(0, timeout.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 'Backend connection failed.')
    }
    if (response.status === 204) return undefined as T
    const body: unknown = await response.json().catch(error => {
      if (options.signal?.aborted) throw error
      if (timeout.aborted) throw new ApiError(0, 'TIMEOUT', 'Backend response timed out.')
      return null
    })
    if (!response.ok) {
      if (response.status === 401) this.csrfToken = undefined
      const details = body && typeof body === 'object' && 'error' in body
        ? body.error as ErrorEnvelope['error'] : undefined
      throw new ApiError(response.status, typeof details?.code === 'string' ? details.code : 'HTTP_ERROR',
        typeof details?.message === 'string' ? details.message : `Backend request failed (${response.status}).`, details)
    }
    if (!body || typeof body !== 'object' || !('data' in body)) {
      throw new ApiError(502, 'INVALID_RESPONSE', 'The backend returned an unexpected response.')
    }
    return body as T
  }

  get<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<T> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
    return this.request<T>(`/api/v1${path}${params.size ? `?${params}` : ''}`, { signal })
  }

  health(kind: 'live' | 'ready', signal?: AbortSignal) {
    return this.request<{ data: { status: string; database?: string } }>(`/health/${kind}`, { signal })
  }

  async csrf(): Promise<string> {
    if (this.csrfToken) return this.csrfToken
    // Deduplicate anonymous-session creation when several callers need a token.
    this.csrfPending ??= this.get<{ data: Csrf }>('/auth/csrf').then(result => {
      this.csrfToken = result.data.csrf_token
      return result.data.csrf_token
    }).finally(() => { this.csrfPending = undefined })
    return this.csrfPending
  }

  async me(signal?: AbortSignal): Promise<Session> {
    const result = await this.get<{ data: Session }>('/auth/me', {}, signal)
    this.csrfToken = result.data.csrf_token
    return result.data
  }

  private async auth<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(`/api/v1/auth/${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await this.csrf() }, body: JSON.stringify(body) })
  }

  async login(input: LoginInput): Promise<Session> {
    const result = await this.auth<{ data: Session }>('login', input)
    this.csrfToken = result.data.csrf_token
    return result.data
  }

  async register(input: RegisterInput): Promise<User> {
    return (await this.auth<{ data: User }>('register', input)).data
  }

  async logout(): Promise<void> {
    await this.auth<void>('logout', {})
    this.csrfToken = undefined
  }

  // Keep this object across uncertain network failures. Never generate a new key for an automatic retry.
  prepare(path: string, method: 'POST' | 'PATCH', body: unknown, version?: number): PreparedMutation {
    return Object.freeze({ path, method, body: JSON.stringify(body), key: crypto.randomUUID(), version })
  }

  async send<T>(action: PreparedMutation): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json',
      'X-CSRF-Token': await this.csrf(), 'Idempotency-Key': action.key }
    if (action.version !== undefined) headers['If-Match'] = `"${action.version}"`
    return this.request<T>(`/api/v1${action.path}`, { method: action.method, body: action.body, headers })
  }
}

export const api = new ApiClient()
