<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { RerollAnimationSlot } from '@shared/types'

const props = defineProps<{ slot: RerollAnimationSlot; index: number }>()
const emit = defineEmits<{ finish: [] }>()
const stopped = ref(false)
let finishTimer: ReturnType<typeof setTimeout> | undefined
const entries = computed(() => {
  const pool = props.slot.samples.length ? props.slot.samples : [props.slot.from]
  return [props.slot.from, ...Array.from({ length: 28 }, (_, i) => pool[(i + props.index) % pool.length]!), props.slot.to]
})
const duration = computed(() => 3000 + (props.index % 6) * 100)
function stop() {
  if (stopped.value) return
  stopped.value = true
  finishTimer = setTimeout(() => emit('finish'), 350)
}
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) emit('finish')
})
onUnmounted(() => clearTimeout(finishTimer))
</script>

<template>
  <span class="trait-roulette" :class="{ stopped }" role="status" :aria-label="stopped ? 'Новая характеристика: ' + slot.to : 'Перераздача характеристики'">
    <span class="roulette-pointer" aria-hidden="true">›</span>
    <span class="roulette-window" aria-hidden="true">
      <span class="roulette-reel" :style="{ '--steps': entries.length - 1, '--duration': duration + 'ms' }" @animationend="stop">
        <span v-for="(entry, i) in entries" :key="i" class="roulette-entry"><span>{{ entry }}</span></span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.trait-roulette {
  --row-height: 4.2rem;
  display: block;
  position: relative;
  min-width: 0;
  border: 1px solid var(--special);
  border-radius: 7px;
  background: var(--surface);
  box-shadow: 0 0 14px color-mix(in srgb, var(--special) 18%, transparent);
}
.roulette-window { display: block; height: var(--row-height); overflow: hidden; }
.roulette-reel { display: block; animation: trait-spin var(--duration) cubic-bezier(.10,.68,.12,1) both; will-change: transform; }
.roulette-entry { height: var(--row-height); box-sizing: border-box; display: flex; align-items: center; padding: 5px 9px 5px 15px; font-size: 13px; line-height: 1.35; }
.roulette-entry > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.roulette-pointer { position: absolute; left: 3px; top: 50%; transform: translateY(-50%); color: var(--special); font-size: 22px; z-index: 1; }
.trait-roulette::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit; background: linear-gradient(var(--surface), transparent 22%, transparent 78%, var(--surface)); }
.trait-roulette.stopped { border-color: var(--success); box-shadow: 0 0 12px color-mix(in srgb, var(--success) 22%, transparent); }
@keyframes trait-spin { from { transform: translateY(0); } to { transform: translateY(calc(-1 * var(--steps) * var(--row-height))); } }
@media (prefers-reduced-motion: reduce) { .roulette-reel { animation: none; transform: translateY(calc(-1 * var(--steps) * var(--row-height))); } }
</style>
