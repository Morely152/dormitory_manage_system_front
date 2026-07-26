<script setup>
import * as ElementPlusIcons from '@element-plus/icons-vue'
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { getModuleDescription, getModulesForRole } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const modules = computed(() => getModulesForRole(auth.currentRole.value))
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
    <section class="portal-intro" aria-labelledby="portal-title">
      <div>
        <!-- <p class="portal-intro__eyebrow">{{ auth.roleInfo.value?.shortLabel }}</p> -->
        <h1 id="portal-title">你好，{{ auth.currentUser.value?.name }}</h1>
        <p>当前角色：<strong>{{ auth.roleInfo.value?.label }}</strong></p>
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
        >
          <span class="module-card__icon" aria-hidden="true">
            <el-icon><component :is="ElementPlusIcons[module.icon]" /></el-icon>
          </span>
          <span class="module-card__content">
            <strong>{{ module.title }}</strong>
            <span>{{ getModuleDescription(module, auth.currentRole.value) }}</span>
          </span>
          <el-icon class="module-card__arrow" aria-hidden="true"><ArrowRight /></el-icon>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
