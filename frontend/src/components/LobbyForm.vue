<template>
  <button :class="customClass" @click="handleClick">{{ text }}</button>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  (e: 'click'): void
}>()

function handleClick() {
  emit('click')
}

defineProps<{
  text: string
  customClass?: string
}>()
</script>