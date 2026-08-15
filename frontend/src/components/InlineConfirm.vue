<script setup lang="ts">
defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <span class="inline-confirm" @click.stop>
    <button class="confirm-btn" type="button" aria-label="Подтвердить" @click="$emit('confirm')">
      ✓
    </button>
    <button class="cancel-btn" type="button" aria-label="Отменить" @click="$emit('cancel')">
      ✕
    </button>
  </span>
</template>

<style scoped>
.inline-confirm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.inline-confirm button {
  width: 28px;
  height: 28px;
  border: 1px solid;
  border-radius: 8px;
  background: var(--surface);
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition:
    transform var(--dur-fast),
    background var(--dur-fast);
}
.inline-confirm button:hover {
  transform: scale(1.08);
}
.confirm-btn {
  color: var(--success);
  border-color: var(--success);
}
.confirm-btn:hover {
  background: color-mix(in srgb, var(--success) 15%, var(--surface));
}
.cancel-btn {
  color: var(--danger);
  border-color: var(--danger);
}
.cancel-btn:hover {
  background: color-mix(in srgb, var(--danger) 15%, var(--surface));
}
</style>
