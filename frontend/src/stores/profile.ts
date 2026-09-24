import { defineStore } from 'pinia'
import { SERVER_URL } from '@/config'
import type { Profile } from '@shared/profile'

export const discordLoginUrl = `${SERVER_URL}/api/auth/discord`
export async function profileRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVER_URL}/api${path}`, { ...options, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Profile-Request': '1', ...options.headers } })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Не удалось выполнить запрос')
  }
  return response.status === 204 ? undefined as T : response.json()
}
export const useProfileStore = defineStore('profile', {
  state: () => ({ user: null as Profile | null, authEnabled: false, loading: true, error: '' }),
  actions: {
    async load() {
      this.loading = true
      this.error = ''
      try {
        const result = await profileRequest<{ user: Profile | null; authEnabled: boolean }>('/auth/session')
        this.user = result.user
        this.authEnabled = result.authEnabled
      } catch (error) { this.error = (error as Error).message }
      finally { this.loading = false }
    },
    async save(nickname: string) {
      const result = await profileRequest<{ user: Profile }>('/profile', { method: 'PATCH', body: JSON.stringify({ nickname }) })
      this.user = result.user
    },
    async logout() {
      await profileRequest('/auth/logout', { method: 'POST' })
      this.user = null
    },
  },
})
