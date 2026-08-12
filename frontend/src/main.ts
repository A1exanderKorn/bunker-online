import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useThemeStore } from './stores/theme'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)
app.use(router)

// Применяем тему до монтирования, чтобы не было мигания.
useThemeStore(pinia).init()

app.mount('#app')
