const TOKEN_KEY = 'lp_token'
const USER_KEY = 'lp_user'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function setToken(token) { localStorage.setItem(TOKEN_KEY, token) }
export function getUser() { const raw = localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) : null }
export function setUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)) }
export function logout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY) }
export function isLoggedIn() { return !!getToken() }
