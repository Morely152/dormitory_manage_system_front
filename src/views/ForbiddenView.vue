<script setup>
import { Lock, Back } from '@element-plus/icons-vue'
</script>

<template>
  <section class="status-page" aria-labelledby="forbidden-title">
    <el-icon class="status-page__icon"><Lock /></el-icon>
    <p>403</p>
    <h1 id="forbidden-title">当前身份无权访问此页面</h1>
    <!-- <span>系统已根据登录角色限制该功能入口。</span> -->
    <el-button type="primary" :icon="Back" @click="$router.replace({ name: 'Portal' })" style="margin-top: 40px;">
      返回工作台
    </el-button>
  </section>
</template>

