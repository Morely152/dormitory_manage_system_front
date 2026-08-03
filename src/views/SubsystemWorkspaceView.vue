<script setup>
import * as ElementPlusIcons from '@element-plus/icons-vue'
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { getModulesForRole, getSubsystem } from '@/config/access'
import { useAuthStore } from '@/stores/auth'
import { useRoute } from 'vue-router'

const route = useRoute()
const auth = useAuthStore()
const subsystem = computed(() => getSubsystem(route.meta.subsystemId))
const modules = computed(() => getModulesForRole(auth.currentRole.value, subsystem.value?.id))
const groupedModules = computed(() => {
  return modules.value.reduce((groups, module) => {
    const group = groups.find((item) => item.name === module.group)
    if (group) {
      group.modules.push(module)
    } else {
      groups.push({ name: module.group, modules: [module] })
    }
    return groups
  }, [])
})
</script>

<template>
  <div class="portal-page">
    <section class="portal-intro" aria-labelledby="workspace-title">
      <div>
        <p class="portal-intro__eyebrow">{{ subsystem?.title }}</p>
        <h1 id="workspace-title">{{ subsystem?.title }}工作台</h1>
        <p>{{ subsystem?.description }}</p>
      </div>
      <div class="portal-intro__status" aria-label="当前可用功能数量">
        <strong>{{ modules.length }}</strong>
        <span>个可用功能</span>
      </div>
    </section>

    <section
      v-for="group in groupedModules"
      :key="group.name"
      class="module-section"
      :aria-labelledby="`group-${group.name}`"
    >
      <div class="section-heading">
        <h2 :id="`group-${group.name}`">{{ group.name }}</h2>
        <span>{{ group.modules.length }} 项</span>
      </div>

      <div class="module-grid">
        <RouterLink
          v-for="module in group.modules"
          :key="module.id"
          class="module-card"
          :class="{ 'module-card--danger': module.tone === 'danger' }"
          :to="{ name: module.routeName }"
          :target="module.id === 'accommodation-query' ? '_blank' : undefined"
          :rel="module.id === 'accommodation-query' ? 'noopener noreferrer' : undefined"
        >
          <span class="module-card__icon" aria-hidden="true">
            <el-icon><component :is="ElementPlusIcons[module.icon]" /></el-icon>
          </span>
          <span class="module-card__content">
            <strong>{{ module.title }}</strong>
            <span>{{ module.description }}</span>
          </span>
          <el-icon class="module-card__arrow" aria-hidden="true"><ArrowRight /></el-icon>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
