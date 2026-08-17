<script setup>
import { Delete, Document, UploadFilled } from '@element-plus/icons-vue'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadFile } from '@/api/media'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  limit: {
    type: Number,
    default: 10,
  },
  maxSizeMb: {
    type: Number,
    default: 20,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'uploading-change'])
const fileList = ref([])
const activeUploads = ref(0)
const fileNames = new Map()
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']

const urls = computed(() =>
  [...new Set((props.modelValue || []).filter((url) => typeof url === 'string' && url))],
)
const isUploading = computed(() => activeUploads.value > 0)
const isFull = computed(() => urls.value.length >= props.limit)

watch(
  urls,
  (value) => {
    fileList.value = value.map((url, index) => ({
      name: fileNames.get(url) || `附件 ${index + 1}`,
      url,
      status: 'success',
      uid: -(index + 1),
    }))
  },
  { immediate: true },
)

watch(isUploading, (value) => emit('uploading-change', value), { immediate: true })

function extensionOf(filename) {
  const index = filename.lastIndexOf('.')
  return index > 0 ? filename.slice(index + 1).toLowerCase() : ''
}

function beforeUpload(file) {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    ElMessage.error('仅支持 PDF、Office 文档、TXT 和 CSV 格式附件')
    return false
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.error(`单个附件不能超过 ${props.maxSizeMb} MB`)
    return false
  }
  return true
}

async function handleUpload({ file, onError, onSuccess }) {
  activeUploads.value += 1
  try {
    const url = await uploadFile(file)
    fileNames.set(url, file.name)
    emit('update:modelValue', [...urls.value, url])
    onSuccess?.({ url })
  } catch (error) {
    ElMessage.error(error?.message || '附件上传失败，请稍后重试')
    onError?.(error)
  } finally {
    activeUploads.value -= 1
  }
}

function handleRemove(file) {
  fileNames.delete(file.url)
  emit('update:modelValue', urls.value.filter((url) => url !== file.url))
}

function handleExceed() {
  ElMessage.warning(`最多上传 ${props.limit} 个附件`)
}
</script>

<template>
  <div class="attachment-upload">
    <el-upload
      :class="{ 'attachment-upload__control--full': isFull }"
      :file-list="fileList"
      :limit="limit"
      :disabled="disabled || isUploading"
      :auto-upload="true"
      :http-request="handleUpload"
      :before-upload="beforeUpload"
      :on-remove="handleRemove"
      :on-exceed="handleExceed"
      drag
      multiple
      aria-label="上传附件"
    >
      <el-icon class="attachment-upload__icon"><UploadFilled /></el-icon>
      <div class="attachment-upload__text">拖拽附件到这里，或 <em>点击选择文件</em></div>
      <template #tip>
        <p class="attachment-upload__hint">
          支持 PDF、Word、Excel、PPT、TXT等格式，单个不超过 {{ maxSizeMb }} MB。
        </p>
      </template>
      <template #file="{ file }">
        <div class="attachment-upload__file">
          <el-icon><Document /></el-icon>
          <a :href="file.url" target="_blank" rel="noopener noreferrer">{{ file.name }}</a>
          <el-button :icon="Delete" text type="danger" aria-label="删除附件" @click="handleRemove(file)" />
        </div>
      </template>
    </el-upload>
  </div>
</template>

<style scoped>
.attachment-upload :deep(.el-upload) {
  width: 100%;
}

.attachment-upload :deep(.el-upload-dragger) {
  width: 100%;
  padding: 24px 18px;
  border-radius: 8px;
  background: #fbfcff;
}

.attachment-upload__control--full :deep(.el-upload) {
  display: none;
}

.attachment-upload__icon {
  color: var(--color-primary);
  font-size: 28px;
}

.attachment-upload__text {
  margin-top: 8px;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.attachment-upload__text em {
  color: var(--color-primary);
  font-style: normal;
}

.attachment-upload__hint {
  margin: 9px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.attachment-upload__file {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.attachment-upload__file > .el-icon {
  flex: 0 0 auto;
  color: var(--color-primary);
}

.attachment-upload__file a {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
