const API_BASE = '/api/v1'

let authToken: string | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    window.location.reload()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Tickets
export const api = {
  tickets: {
    list: (params?: Record<string, string>) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : ''
      return request<any[]>(`/tickets${qs}`)
    },
    get: (id: string) => request<any>(`/tickets/${id}`),
    create: (data: any) => request<any>('/tickets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<void>(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request<void>(`/tickets/${id}`, { method: 'DELETE' }),
    bulk: (ids: string[], action: string, extra?: Record<string, string>) => request<any>('/tickets/bulk', { method: 'POST', body: JSON.stringify({ ids, action, ...extra }) }),
    merge: (ids: string[]) => request<any>('/tickets/merge', { method: 'POST', body: JSON.stringify({ ids }) }),
    reply: (id: string, msg: any) => request<any>(`/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify(msg) }),
    retrySend: (id: string, messageIndex: number) => request<any>(`/tickets/${id}/retry-send`, { method: 'POST', body: JSON.stringify({ message_index: messageIndex }) }),
    assign: (id: string, assigneeId: string) => request<void>(`/tickets/${id}/assign`, { method: 'PUT', body: JSON.stringify({ assignee_id: assigneeId }) }),
    setStatus: (id: string, status: string) => request<void>(`/tickets/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  },
  users: {
    list: () => request<any[]>('/users'),
    get: (id: string) => request<any>(`/users/${id}`),
    create: (data: any) => request<any>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<void>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
  settings: {
    get: () => request<any>('/settings'),
    updateEmail: (data: any) => request<void>('/settings/email', { method: 'PUT', body: JSON.stringify(data) }),
    updateLLM: (data: any) => request<void>('/settings/llm', { method: 'PUT', body: JSON.stringify(data) }),
    updateAuth: (data: any) => request<void>('/settings/auth', { method: 'PUT', body: JSON.stringify(data) }),
    updateSignature: (signature: string) => request<void>('/settings/signature', { method: 'PUT', body: JSON.stringify({ signature }) }),
  },
  email: {
    mailboxes: (config: any) => request<any[]>('/email/mailboxes', { method: 'POST', body: JSON.stringify(config) }),
    fetch: () => request<any>('/email/fetch', { method: 'POST' }),
    reparse: () => request<any>('/email/reparse', { method: 'POST' }),
  },
  stats: () => request<any>('/stats'),
  login: (email: string, password: string) => request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
}
