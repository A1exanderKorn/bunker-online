<script setup lang="ts">
import { computed } from 'vue'
import { requirementsView } from '@shared/bunkerDisplay'

const props = defineProps<{ requirements: string[][]; percentages?: { tag: string; label: string; percent: number }[] }>()
const view = computed(() => requirementsView(props.requirements))
</script>

<template>
  <div class="req-block">
    <template v-if="percentages">
      <p class="req-heading">{{ percentages.length ? 'Нужно набрать каждую шкалу. Вклад команды суммируется.' : 'Специальные ресурсы не требуются.' }}</p>
      <div v-for="row in percentages" :key="row.tag" class="capability-row">
        <span>{{ row.label }}</span><b>{{ row.percent }}%</b>
        <progress :value="row.percent" max="100" :aria-label="`${row.label}: требуется ${row.percent}%`" />
      </div>
    </template>
    <p v-else-if="view.kind === 'none'" class="req-faint">{{ view.heading }}</p>
    <template v-else>
      <p class="req-heading">{{ view.heading }}</p>
      <p v-if="view.kind === 'single'" class="req-single">{{ view.label }}</p>
      <ul v-else-if="view.kind === 'or'" class="req-list">
        <li v-for="label in view.labels" :key="label">{{ label }}</li>
      </ul>
      <ol v-else class="req-list req-and">
        <li v-for="(item, index) in view.items" :key="index">
          <template v-if="item.kind === 'tag'">{{ item.label }}</template>
          <template v-else>
            одно из:
            <ul class="req-list req-nested">
              <li v-for="label in item.labels" :key="label">{{ label }}</li>
            </ul>
          </template>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.capability-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 8px 0; font-size: 12px; }
.capability-row progress { grid-column: 1 / -1; width: 100%; height: 7px; accent-color: var(--info); }
.req-block {
  margin-top: 8px;
  text-align: left;
}
.req-heading {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.req-faint {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}
.req-single {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
.req-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
}
.req-nested {
  margin-top: 2px;
  padding-left: 14px;
}
</style>
