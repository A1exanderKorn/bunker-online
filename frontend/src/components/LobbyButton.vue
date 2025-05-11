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

<style lang="css" scoped>
  .base-button{
    font: bold;
    background-color: burlywood;
    font-size: 26px;
    font: bold;
    width: 300px;
  }

</style>