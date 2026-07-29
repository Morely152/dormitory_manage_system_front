<script setup>
import { OfficeBuilding } from '@element-plus/icons-vue'

defineProps({
  title: {
    type: String,
    required: true,
  },
  headingId: {
    type: String,
    default: 'bed-information-title',
  },
  icon: {
    type: Object,
    default: () => OfficeBuilding,
  },
  description: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    default: '',
  },
  fields: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <section class="bed-information-card" :aria-labelledby="headingId">
    <header class="bed-information-card__header">
      <span class="bed-information-card__icon" aria-hidden="true">
        <el-icon><component :is="icon" /></el-icon>
      </span>
      <div class="bed-information-card__heading">
        <h2 :id="headingId">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <span v-if="status" class="bed-information-card__status">{{ status }}</span>
    </header>

    <dl class="bed-information-list">
      <div v-for="field in fields" :key="field.label" class="bed-information-list__item">
        <dt>{{ field.label }}</dt>
        <dd :class="{ 'is-empty': !field.value }">{{ field.value || '--' }}</dd>
      </div>
    </dl>

    <footer v-if="$slots.default" class="bed-information-card__footer">
      <slot />
    </footer>
  </section>
</template>

<style scoped>
.bed-information-card {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.bed-information-card__header {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 24px 28px;
  border-bottom: 1px solid var(--color-border);
}

.bed-information-card__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.bed-information-card__icon .el-icon {
  font-size: 24px;
}

.bed-information-card__heading h2 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
}

.bed-information-card__heading p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.bed-information-card__status {
  padding: 6px 10px;
  border: 1px solid #c8d7f4;
  border-radius: 4px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.bed-information-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  padding: 8px 28px;
}

.bed-information-list__item {
  display: grid;
  min-width: 0;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid #edf0f5;
}

.bed-information-list__item:nth-last-child(-n + 2) {
  border-bottom: 0;
}

.bed-information-list__item:nth-child(odd) {
  padding-right: 28px;
}

.bed-information-list__item:nth-child(even) {
  padding-left: 28px;
  border-left: 1px solid #edf0f5;
}

.bed-information-list dt,
.bed-information-list dd {
  min-width: 0;
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.bed-information-list dt {
  color: var(--color-text-muted);
  font-size: 14px;
}

.bed-information-list dd {
  color: var(--color-text);
  font-size: 15px;
  font-weight: 600;
}

.bed-information-list dd.is-empty {
  color: #9aa5b6;
  font-weight: 500;
}

.bed-information-card__footer {
  padding: 20px 28px 24px;
  border-top: 1px solid var(--color-border);
  background: #fafbfd;
}

@media (max-width: 640px) {
  .bed-information-card__header {
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 12px;
    padding: 20px;
  }

  .bed-information-card__icon {
    width: 44px;
    height: 44px;
  }

  .bed-information-card__status {
    grid-column: 2;
    width: max-content;
  }

  .bed-information-list {
    grid-template-columns: 1fr;
    padding: 4px 20px;
  }

  .bed-information-list__item {
    grid-template-columns: 80px minmax(0, 1fr);
    gap: 12px;
    padding: 15px 0;
  }

  .bed-information-list__item:nth-child(odd),
  .bed-information-list__item:nth-child(even) {
    padding-right: 0;
    padding-left: 0;
    border-left: 0;
  }

  .bed-information-list__item:nth-last-child(2) {
    border-bottom: 1px solid #edf0f5;
  }

  .bed-information-card__footer {
    padding: 18px 20px 20px;
  }
}
</style>
