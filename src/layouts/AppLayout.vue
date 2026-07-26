<script setup>
import { ArrowDown, House, SwitchButton } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

function handleCommand(command) {
  if (command === 'portal') {
    router.push({ name: 'Portal' })
  }

  if (command === 'logout') {
    auth.logout()
    router.replace({ name: 'Login' })
  }
}
</script>

<template>
  <div class="app-layout">
    <a class="skip-link" href="#main-content">跳到主要内容</a>

    <header class="app-header">
      <RouterLink class="brand" :to="{ name: 'Portal' }" aria-label="返回宿舍床位管理系统工作台">
        <span class="brand__mark" aria-hidden="true">D</span>
        <span class="brand__text">
          <strong>宿舍床位管理系统</strong>
          <small>Dormitory Management</small>
        </span>
      </RouterLink>

      <div class="header-user">
        <span class="header-user__role">{{ auth.roleInfo.value?.label }}</span>
        <el-dropdown trigger="click" @command="handleCommand">
          <button class="user-menu" type="button" aria-label="打开用户菜单">
            <span class="user-menu__avatar">{{ auth.currentUser.value?.name?.slice(0, 1) }}</span>
            <span class="user-menu__name">{{ auth.currentUser.value?.name }}</span>
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="portal">
                <el-icon><House /></el-icon>
                工作台
              </el-dropdown-item>
              <el-dropdown-item divided command="logout">
                <el-icon><SwitchButton /></el-icon>
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main id="main-content" class="app-main" tabindex="-1">
      <div v-if="route.name !== 'Portal'" class="breadcrumb-wrap">
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ name: 'Portal' }">工作台</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
        </el-breadcrumb>
      </div>

      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
  </div>
</template>

