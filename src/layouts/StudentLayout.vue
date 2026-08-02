<script setup>
import { ArrowDown, CircleCheck, SwitchButton, View } from '@element-plus/icons-vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const mainRef = ref()

const displayName = computed(() => auth.currentUser.value?.name || '同学')
const avatarText = computed(() => displayName.value.slice(0, 1))

const navigation = [
  {
    name: 'StudentConfirmation',
    label: '住宿信息确认',
    icon: CircleCheck,
  },
  {
    name: 'StudentBedInformation',
    label: '我的住宿信息',
    icon: View,
  },
]

watch(
  () => route.fullPath,
  async () => {
    await nextTick()
    mainRef.value?.focus()
  },
)

function logout() {
  auth.logout()
  router.replace({ name: 'Login' })
}
</script>

<template>
  <div class="student-shell">
    <a class="skip-link" href="#student-main">跳到主要内容</a>

    <header class="student-header">
      <div class="student-header__inner">
        <RouterLink
          class="student-brand"
          :to="{ name: 'StudentConfirmation' }"
          aria-label="返回学生端住宿信息确认页"
        >
          <span class="student-brand__mark" aria-hidden="true">D</span>
          <span class="student-brand__text">
            <strong>学生住宿服务</strong>
            <small>学生公寓管理系统</small>
          </span>
        </RouterLink>

        <nav class="student-desktop-nav" aria-label="学生端主导航">
          <RouterLink
            v-for="item in navigation"
            :key="item.name"
            class="student-desktop-nav__item"
            :to="{ name: item.name }"
            :aria-current="route.name === item.name ? 'page' : undefined"
          >
            <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </RouterLink>
        </nav>

        <el-dropdown class="student-user-dropdown" trigger="click" @command="logout">
          <button class="student-user" type="button" aria-label="打开用户菜单">
            <span class="student-user__avatar" aria-hidden="true">{{ avatarText }}</span>
            <span class="student-user__name">{{ displayName }}</span>
            <el-icon class="student-user__arrow" aria-hidden="true"><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">
                <el-icon><SwitchButton /></el-icon>
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main id="student-main" ref="mainRef" class="student-main" tabindex="-1">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <nav class="student-bottom-nav" aria-label="学生端主导航">
      <RouterLink
        v-for="item in navigation"
        :key="item.name"
        class="student-bottom-nav__item"
        :to="{ name: item.name }"
        :aria-current="route.name === item.name ? 'page' : undefined"
      >
        <el-icon aria-hidden="true"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.student-shell {
  min-height: 100vh;
  min-height: 100dvh;
  background: #f5f7fb;
}

.student-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--color-border);
  background: rgb(255 255 255 / 96%);
  box-shadow: var(--shadow-sm);
}

.student-header__inner {
  display: grid;
  width: min(100%, 1120px);
  height: 72px;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 32px;
  margin: 0 auto;
  padding: 0 24px;
}

.student-brand {
  display: inline-flex;
  width: max-content;
  min-height: 48px;
  align-items: center;
  gap: 12px;
}

.student-brand__mark {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  color: #fff;
  background: var(--color-primary);
  font-weight: 700;
}

.student-brand__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.student-brand__text strong {
  font-size: 16px;
}

.student-brand__text small {
  color: var(--color-text-muted);
  font-size: 12px;
}

.student-desktop-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.student-desktop-nav__item {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 14px;
  font-weight: 600;
  transition:
    color var(--motion-fast),
    background-color var(--motion-fast);
}

.student-desktop-nav__item:hover {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.student-desktop-nav__item[aria-current='page'] {
  color: #fff;
  background: var(--color-primary);
}

.student-user {
  display: flex;
  min-width: 0;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  padding: 4px;
  border: 0;
  color: var(--color-text);
  background: transparent;
}

.student-user-dropdown {
  justify-self: end;
}

.student-user__avatar {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #365ea9;
  font-size: 14px;
  font-weight: 600;
}

.student-user__name {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.student-main {
  width: min(100%, 920px);
  min-height: calc(100vh - 72px);
  min-height: calc(100dvh - 72px);
  margin: 0 auto;
  padding: 48px 24px 72px;
}

.student-bottom-nav {
  display: none;
}

@media (max-width: 760px) {
  .student-header__inner {
    height: 64px;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    padding: 0 16px;
  }

  .student-desktop-nav {
    display: none;
  }

  .student-user__name,
  .student-user__arrow,
  .student-brand__text small {
    display: none;
  }

  .student-main {
    min-height: calc(100vh - 64px);
    min-height: calc(100dvh - 64px);
    padding: 28px 16px calc(112px + env(safe-area-inset-bottom));
  }

  .student-bottom-nav {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 6px max(12px, env(safe-area-inset-right)) max(6px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    border-top: 1px solid var(--color-border);
    background: rgb(255 255 255 / 98%);
    box-shadow: 0 -8px 24px rgb(25 48 90 / 8%);
  }

  .student-bottom-nav__item {
    display: flex;
    min-height: 56px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 6px;
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    transition:
      color var(--motion-fast),
      background-color var(--motion-fast);
  }

  .student-bottom-nav__item .el-icon {
    font-size: 22px;
  }

  .student-bottom-nav__item:active {
    background: var(--color-primary-soft);
  }

  .student-bottom-nav__item[aria-current='page'] {
    color: var(--color-primary);
    background: var(--color-primary-soft);
  }
}

@media (max-width: 380px) {
  .student-brand__mark {
    width: 36px;
    height: 36px;
  }

  .student-brand__text strong {
    font-size: 15px;
  }
}
</style>
