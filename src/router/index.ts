import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import LobbyView from '@/views/LobbyView.vue'

const routes = [
  { path: '/', component: HomeView },
  { path: '/lobby', component: LobbyView },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
