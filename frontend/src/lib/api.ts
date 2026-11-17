import { getToken } from '@/lib/token'

const API_PREFIX = '/api/v1'

export type Role = 'admin' | 'operator'

export type User = {
  id: string
  email: string
  role: Role
  active: boolean
  last_login_at: string | null
}

export type TokenResponse = {
  access_token: string
  token_type: 'bearer'
  expires_in: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ErrorBody = {
  detail?: unknown
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as ErrorBody
    return typeof body.detail === 'string' ? body.detail : null
  } catch {
    return null
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getToken()
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('Cannot reach the API. Is the backend running?', 0)
  }

  if (!response.ok) {
    throw new ApiError(
      (await readErrorDetail(response)) ?? response.statusText,
      response.status,
    )
  }

  return (await response.json()) as T
}

export function signIn(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function getCurrentUser(): Promise<User> {
  return request<User>('/auth/me')
}
