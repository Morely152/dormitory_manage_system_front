<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock, OfficeBuilding, User } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getRole } from '@/config/access'
import { login as loginApi } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'


const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const formRef = ref()
const submitting = ref(false)

const form = reactive({
  userCode: '',
  password: '',
})

const rules = {
  userCode: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

function getLoginErrorMessage(error) {
  if (error.code === 'ECONNABORTED') {
    return '登录请求超时，请稍后重试'
  }

  return error.response?.data?.message || error.message || '登录失败，请检查账号和密码'
}

async function submit() {
  if (submitting.value) return

  submitting.value = true
  try {
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return

    auth.logout()

    const response = await loginApi({
      userCode: form.userCode,
      password: form.password,
    })

    if (response?.code !== 0) {
      throw new Error(response?.message || '登录失败，请检查账号和密码')
    }

    const loginData = response.data
    if (!loginData?.token || !loginData?.user?.roleCode) {
      throw new Error('登录响应缺少 token 或角色信息')
    }

    if (!getRole(loginData.user.roleCode)) {
      throw new Error(`当前账号角色（${loginData.user.roleCode}）尚未配置访问权限`)
    }

    auth.setLoginSession(loginData)
    ElMessage.success('登录成功')

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/portal'
    await router.replace(redirect)
  } catch (error) {
    ElMessage.error(getLoginErrorMessage(error))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-brand" aria-labelledby="system-name">
      <div class="login-brand__content">
        <div class="login-brand__icon" aria-hidden="true">
          <el-icon><OfficeBuilding /></el-icon>
        </div>
        <p class="login-brand__eyebrow" style="font-size: 30px;">赣南师范大学</p>
        <h1 id="system-name">学生公寓管理系统</h1>
        <p class="login-brand__slogan">连接学生与寝室的信息协同一体化平台</p>
      </div>
      <p class="login-brand__footer">Dormitory Management System</p>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-form-wrap">
        <header class="login-form-header">
          <div class="login-form-header__mark" aria-hidden="true" style="border: 2px solid rgb(255 255 255 / 28%); font-size: 24px;">
            <el-icon><Lock /></el-icon>
          </div>
          <div>
            <h2 id="login-title">统一身份登录</h2>
          </div>
        </header>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          @submit.prevent="submit"
        >
          <el-form-item label="账号" prop="userCode">
            <el-input
              v-model.trim="form.userCode"
              :prefix-icon="User"
              autocomplete="username"
              placeholder="请输入账号"
            />
          </el-form-item>

          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              :prefix-icon="Lock"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              show-password
            />
          </el-form-item>

          <el-button class="login-submit" type="primary" native-type="submit" :loading="submitting">
            登录并进入工作台
          </el-button>
        </el-form>

      </div>
    </section>

  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  grid-template-columns: minmax(360px, 0.9fr) minmax(520px, 1.1fr);
  background: var(--color-surface);
}

.login-brand {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(40px, 6vw, 80px);
  color: #fff;
  background: #173a95;
}

.login-brand__content {
  max-width: 520px;
  margin: auto 0;
}

.login-brand__icon {
  display: grid;
  width: 64px;
  height: 64px;
  margin-bottom: 32px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 8px;
  background: rgb(255 255 255 / 12%);
}

.login-brand__icon .el-icon {
  font-size: 32px;
}

.login-brand__eyebrow {
  margin: 0 0 12px;
  color: #bfd1ff;
  font-size: 15px;
  font-weight: 600;
}

.login-brand h1 {
  margin: 0;
  font-size: clamp(34px, 4vw, 52px);
  font-weight: 650;
  letter-spacing: 0;
}

.login-brand__content > p:last-child {
  max-width: 480px;
  margin: 24px 0 0;
  color: #dce6ff;
  font-size: 17px;
  line-height: 1.8;
}

.login-brand__footer {
  margin: 48px 0 0;
  color: #aabde9;
  font-size: 13px;
}

.login-panel {
  display: grid;
  place-items: center;
  padding: clamp(32px, 7vw, 96px);
}

.login-form-wrap {
  width: min(100%, 420px);
}

.login-form-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 36px;
}

.login-form-header__mark {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 6px;
  color: #fff;
  background: var(--color-primary);
  font-size: 20px;
  font-weight: 700;
}

.login-form-header h2 {
  margin: 0;
  font-size: 26px;
  letter-spacing: 0;
}

.login-form-header p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
}

.login-role-select,
.login-submit {
  width: 100%;
}

.form-helper {
  margin: 7px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.login-submit {
  min-height: 46px;
  margin-top: 10px;
  font-weight: 600;
}

@media(max-width: 960px) {
    .login-page {
    grid-template-columns: minmax(300px, 0.8fr) minmax(440px, 1.2fr);
  }

  .login-brand,
  .login-panel {
    padding: 40px;
  }

  .module-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .login-page {
    display: block;
    background: var(--color-surface);
  }

 .login-brand__footer, .login-brand__slogan {
  display: none;
}

  .login-panel {
    /* min-height: 100vh; */
    /* min-height: 100dvh; */
    padding: 32px 24px;
  }

  .login-form-header__mark {
    display: grid;
  }
}
</style>
