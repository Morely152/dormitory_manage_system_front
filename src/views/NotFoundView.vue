<script setup>
import { Back } from '@element-plus/icons-vue'
</script>

<template>
  <main class="standalone-status">
    <section class="status-page" aria-labelledby="not-found-title">
      <p>404</p>
      <h1 id="not-found-title">页面不存在</h1>
      <span>请检查访问地址，或返回系统工作台。</span>
      <el-button type="primary" :icon="Back" @click="$router.replace('/')">返回系统</el-button>
    </section>
  </main>
</template>

