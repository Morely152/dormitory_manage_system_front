<script setup>
import * as ElementPlusIcons from '@element-plus/icons-vue'
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { getSubsystemsForRole } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const subsystems = computed(() => getSubsystemsForRole(auth.currentRole.value))
</script>

<template>
  <div class="portal-page system-selector-page">
    <section class="portal-intro" aria-labelledby="portal-title">
      <div>
        <p class="portal-intro__eyebrow">综合服务入口</p>
        <h1 id="portal-title">你好，{{ auth.currentUser.value?.name }}</h1>
        <p>请选择要进入的业务系统。</p>
      </div>
      <div class="portal-intro__status" aria-label="当前可进入的子系统数量">
        <strong>{{ subsystems.length }}</strong>
        <span>个可用系统</span>
      </div>
    </section>

    <section class="system-selector" aria-labelledby="system-selector-title">
      <div class="section-heading">
        <h2 id="system-selector-title">可用系统</h2>
      </div>
      <div class="system-grid">
        <RouterLink
          v-for="subsystem in subsystems"
          :key="subsystem.id"
          class="system-card"
          :to="{ name: subsystem.routeName }"
        >
          <span class="system-card__icon" aria-hidden="true">
            <el-icon><component :is="ElementPlusIcons[subsystem.icon]" /></el-icon>
          </span>
          <span class="system-card__content">
            <strong>{{ subsystem.title }}</strong>
            <span>{{ subsystem.description }}</span>
          </span>
          <el-icon class="system-card__arrow" aria-hidden="true"><ArrowRight /></el-icon>
        </RouterLink>
      </div>
    </section>
  </div>
</template>
