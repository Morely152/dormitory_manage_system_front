<script setup>
import * as ElementPlusIcons from '@element-plus/icons-vue'
import { computed } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { getModule, getModuleDescription } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const currentModule = computed(() => getModule(route.meta.moduleId))
const description = computed(() => getModuleDescription(currentModule.value, auth.currentRole.value))

function backToWorkspace() {
  router.push({ name: currentModule.value?.subsystem ? `${currentModule.value.subsystem[0].toUpperCase()}${currentModule.value.subsystem.slice(1)}Workspace` : 'Portal' })
}
</script>

<template>
  <div v-if="currentModule" class="feature-page">
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
      <h2 id="workspace-title">暂无可展示的记录</h2>
      <p>请在有新的业务事项后返回查看。</p>
      <el-button :icon="ArrowLeft" @click="backToWorkspace">返回工作台</el-button>
    </section>
  </div>
</template>
