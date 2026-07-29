<script setup>
import { ref } from 'vue'

const visible = ref(true)

function closeDialog() {
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="student-information-warning-dialog"
    title="重要提示"
    width="480px"
    :show-close="true"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    align-center
  >
    <p class="student-information-warning-dialog__message">
      学生住宿信息的确认决定整个系统的数据准确性，请务必仔细核对！
    </p>

    <template #footer>
      <el-button type="danger" @click="closeDialog">我已了解</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.student-information-warning-dialog__message {
  margin: 0;
  color: #c45656;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.8;
}

:global(.student-information-warning-dialog) {
  max-width: calc(100vw - 32px);
  border: 2px solid #c45656;
  border-radius: 8px;
}

:global(.student-information-warning-dialog .el-dialog__header) {
  margin-right: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid #f2c9c7;
}

:global(.student-information-warning-dialog .el-dialog__title) {
  color: #c45656;
  font-size: 20px;
  font-weight: 700;
}

:global(.student-information-warning-dialog .el-dialog__footer) {
  padding-top: 16px;
  border-top: 1px solid #f2c9c7;
  text-align: center;
}

@media (max-width: 640px) {
  .student-information-warning-dialog__message {
    font-size: 16px;
  }
}
</style>
