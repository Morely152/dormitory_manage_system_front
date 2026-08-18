<script setup>
import { ChatLineRound, CircleCheckFilled, DocumentAdd } from '@element-plus/icons-vue'
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import ImageUpload from '@/components/ImageUpload.vue'
import OpinionAttachmentUpload from '@/components/OpinionAttachmentUpload.vue'
import OpinionAdminView from '@/views/OpinionAdminView.vue'
import { submitOpinion } from '@/api/opinion'
import { ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const formRef = ref()
const submitting = ref(false)
const submittedOpinionId = ref(null)
const imageUrls = ref([])
const attachmentUrls = ref([])
const imageUploading = ref(false)
const attachmentUploading = ref(false)
const form = reactive({
  description: '',
  studentEmail: '',
})

const isAdministrator = computed(() =>
  [ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.DORMITORY_ADMIN].includes(auth.currentRole.value),
)
const isStudent = computed(() => auth.currentRole.value === ROLE_KEYS.STUDENT)
const hasActiveUpload = computed(() => imageUploading.value || attachmentUploading.value)
const rules = {
  description: [
    { required: true, message: '请填写意见说明', trigger: 'blur' },
    { max: 5000, message: '意见说明不能超过 5000 个字符', trigger: 'blur' },
  ],
  studentEmail: [
    { required: true, message: '请填写联系邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱地址', trigger: ['blur', 'change'] },
  ],
}

function requestErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  if (hasActiveUpload.value) {
    ElMessage.warning('图片或附件正在上传，请完成后再提交')
    return
  }

  submitting.value = true
  submittedOpinionId.value = null
  try {
    const result = await submitOpinion({
      description: form.description.trim(),
      studentEmail: form.studentEmail.trim(),
      imageUrls: imageUrls.value,
      attachmentUrls: attachmentUrls.value,
    })
    submittedOpinionId.value = result?.opinionId ?? null
    form.description = ''
    form.studentEmail = ''
    imageUrls.value = []
    attachmentUrls.value = []
    formRef.value?.clearValidate()
    ElMessage.success('意见反馈已提交')
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '意见提交失败，请稍后重试'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="isStudent" class="opinion-page">
    <section class="opinion-hero" aria-labelledby="opinion-page-title">
      <div class="opinion-hero__icon" aria-hidden="true">
        <el-icon><ChatLineRound /></el-icon>
      </div>
      <div>
        <h1 id="opinion-page-title">意见征集</h1>
        <span>你的每一条建议都将帮助我们持续改进宿舍服务。</span>
      </div>
    </section>

    <section class="opinion-form-card" aria-labelledby="opinion-form-title">
      <!-- <div class="opinion-form-card__heading">
        <div>
          <h2 id="opinion-form-title">提交意见反馈</h2>
          <p>请尽量清楚地描述你的建议或遇到的问题，便于后续跟进。</p>
        </div>
      </div> -->

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="handleSubmit">
        <el-form-item label="意见说明" prop="description" required>
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="7"
            maxlength="5000"
            show-word-limit
            :disabled="submitting"
            placeholder="请描述你的意见、建议或希望改进的事项"
          />
        </el-form-item>

        <div class="opinion-form-card__media-grid">
          <el-form-item label="补充图片">
            <ImageUpload
              v-model="imageUrls"
              :limit="9"
              :max-size-mb="20"
              purpose="OPINION_FEEDBACK"
              :disabled="submitting"
              @uploading-change="imageUploading = $event"
            />
          </el-form-item>
          <el-form-item label="相关附件">
            <OpinionAttachmentUpload
              v-model="attachmentUrls"
              :limit="10"
              :max-size-mb="20"
              :disabled="submitting"
              @uploading-change="attachmentUploading = $event"
            />
          </el-form-item>
        </div>

        <el-form-item label="联系邮箱" prop="studentEmail" required>
          <el-input
            v-model="form.studentEmail"
            type="email"
            maxlength="255"
            :disabled="submitting"
            placeholder="用于接收处理进展或补充沟通"
          />
        </el-form-item>

        <div class="opinion-submit-row">
          <span>请确认内容真实、准确。</span>
          <el-button
            native-type="submit"
            type="primary"
            size="large"
            :icon="DocumentAdd"
            :loading="submitting"
            :disabled="hasActiveUpload"
          >
            {{ hasActiveUpload ? '正在上传材料' : '提交意见反馈' }}
          </el-button>
        </div>
      </el-form>
    </section>

    <section v-if="submittedOpinionId" class="opinion-result" role="status" aria-live="polite">
      <el-icon><CircleCheckFilled /></el-icon>
      <div>
        <strong>意见反馈已提交，请留意后续处理进展。</strong>
      </div>
    </section>
  </div>

  <OpinionAdminView v-else-if="isAdministrator" />

  <div v-else class="opinion-admin-placeholder">
    <section class="opinion-admin-placeholder__panel">
      <div class="opinion-admin-placeholder__icon" aria-hidden="true">
        <el-icon><ChatLineRound /></el-icon>
      </div>
      <h1>暂无访问权限</h1>
      <p>仅学生可提交意见，系统管理员和宿管中心管理员可查看及处理反馈。</p>
    </section>
  </div>
</template>

<style scoped>
.opinion-page {
  display: grid;
  gap: 20px;
  box-sizing: border-box;
  width: min(calc(100% - 24px), 1120px);
  margin-inline: auto;
}

.opinion-hero,
.opinion-form-card,
.opinion-result,
.opinion-admin-placeholder__panel {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.opinion-hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 28px 30px;
  border-color: #dbe7fb;
  background: linear-gradient(125deg, #f8fbff, #edf5ff);
}

.opinion-hero__icon {
  display: grid;
  width: 58px;
  height: 58px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 16px;
  color: #fff;
  background: #3b70c5;
  box-shadow: 0 9px 20px rgb(59 112 197 / 24%);
  font-size: 29px;
}

.opinion-hero p,
.opinion-hero h1,
.opinion-hero span,
.opinion-form-card__heading h2,
.opinion-form-card__heading p {
  margin: 0;
}

.opinion-hero p {
  margin-bottom: 5px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
}

.opinion-hero h1 {
  color: var(--color-text);
  font-size: 24px;
}

.opinion-hero span,
.opinion-form-card__heading p {
  display: block;
  margin-top: 7px;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.opinion-form-card {
  padding: 34px 38px;
}

.opinion-form-card__heading,
.opinion-submit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.opinion-form-card__heading {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--color-border);
}

.opinion-form-card__heading h2 {
  color: var(--color-text);
  font-size: 19px;
}

.opinion-tip {
  margin: 20px 0;
}

.opinion-form-card :deep(.el-form-item__label) {
  font-weight: 650;
}

.opinion-form-card :deep(.el-input__wrapper),
.opinion-form-card :deep(.el-textarea__inner) {
  border-radius: 7px;
}

.opinion-form-card__media-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
}

.opinion-form-card__media-grid :deep(.el-form-item) {
  align-content: start;
}

.opinion-submit-row {
  margin-top: 4px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.opinion-submit-row > span {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.opinion-submit-row .el-button {
  min-width: 156px;
  min-height: 44px;
}

.opinion-result {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 17px 20px;
  border-color: #a7dfbf;
  color: #155d38;
  background: #effaf3;
}

.opinion-result > .el-icon {
  margin-top: 2px;
  font-size: 20px;
}

.opinion-result strong,
.opinion-result span {
  display: block;
}

.opinion-result span {
  margin-top: 4px;
  color: #397653;
  font-size: 13px;
}

.opinion-admin-placeholder {
  display: grid;
  min-height: 440px;
  place-items: center;
}

.opinion-admin-placeholder__panel {
  width: min(100%, 560px);
  padding: 44px 32px;
  text-align: center;
}

.opinion-admin-placeholder__icon {
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  margin: 0 auto 16px;
  border-radius: 16px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size: 27px;
}

.opinion-admin-placeholder h1,
.opinion-admin-placeholder p {
  margin: 0;
}

.opinion-admin-placeholder h1 {
  color: var(--color-text);
  font-size: 20px;
}

.opinion-admin-placeholder p,
.opinion-admin-placeholder span {
  display: block;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.opinion-admin-placeholder p {
  margin-top: 9px;
}

.opinion-admin-placeholder span {
  margin-top: 14px;
  color: var(--color-text-muted);
  font-size: 13px;
}

@media (max-width: 680px) {
  .opinion-hero,
  .opinion-form-card {
    padding: 22px 18px;
  }

  .opinion-hero {
    align-items: flex-start;
    gap: 13px;
  }

  .opinion-hero__icon {
    width: 48px;
    height: 48px;
    border-radius: 13px;
    font-size: 24px;
  }

  .opinion-hero h1 {
    font-size: 21px;
  }

  .opinion-form-card__heading,
  .opinion-submit-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .opinion-form-card__media-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .opinion-submit-row .el-button {
    width: 100%;
    min-height: 48px;
  }
}
</style>
