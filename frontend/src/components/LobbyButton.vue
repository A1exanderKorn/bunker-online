<template>
  <button :class="btnClass" @click="handleClick">{{ text }}</button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const emit = defineEmits<{ (e: 'click'): void }>()
const props = defineProps<{
  text: string
  /** Совместимость со старым API: base/confirm/danger + новые btn-классы. */
  customClass?: string
}>()

function handleClick() {
  emit('click')
}

// Маппинг старых классов на новую дизайн-систему.
const btnClass = computed(() => {
  const c = props.customClass ?? ''
  if (c.includes('confirm')) return 'btn btn--success btn--block'
  if (c.includes('danger')) return 'btn btn--danger'
  if (c.includes('base')) return 'btn btn--primary btn--block'
  return 'btn ' + c
})
</script>
