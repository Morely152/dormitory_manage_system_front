<script setup>
import * as ElementPlusIcons from '@element-plus/icons-vue'
import { computed } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { getModule, getModuleDescription } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()
const currentModule = computed(() => getModule(route.meta.moduleId))
const description = computed(() =>
  getModuleDescription(currentModule.value, auth.currentRole.value),
)
</script>

<template>
  <div class="feature-page">
    <header class="feature-header">
      <div class="feature-header__icon" aria-hidden="true">
        <el-icon><component :is="ElementPlusIcons[currentModule.icon]" /></el-icon>
      </div>
      <div>
        <p>{{ currentModule.group }}</p>
        <h1>{{ currentModule.title }}</h1>
        <span>{{ description }}</span>
      </div>
    </header>

    <section class="empty-workspace" aria-labelledby="workspace-title">
      <div class="empty-workspace__mark" aria-hidden="true"></div>
      <h2 id="workspace-title">页面路由已就绪</h2>
      <p>当前阶段已完成入口和访问权限配置，业务功能将在后续阶段接入。</p>
      <el-button :icon="ArrowLeft" @click="$router.push({ name: 'Portal' })">返回工作台</el-button>
    </section>
  </div>
</template>
