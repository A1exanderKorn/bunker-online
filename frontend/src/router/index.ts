import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import LobbyView from '@/views/LobbyView.vue'

const routes: Array<RouteRecordRaw> = [
  { path: '/', name: 'Home', component: HomeView },
  { path: '/lobby/:code', name: 'Lobby', component: LobbyView },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
