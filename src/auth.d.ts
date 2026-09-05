export const ADMIN_USERNAME: string
export const ADMIN_PASSWORD: string
export const SESSION_KEY: string
export const SESSION_TTL_MS: number
export function validateLogin(credentials?: { username?: string; password?: string }): boolean
export function readSession(): boolean
export function saveSession(): void
export function clearSession(): void
