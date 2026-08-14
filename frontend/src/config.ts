/** Адрес игрового сервера. В проде пустая строка = тот же origin (один сервис). */
export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000')
