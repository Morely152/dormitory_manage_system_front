<script setup>
import { computed, ref, watch } from 'vue'
import { Delete, Plus, View } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/api/media'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => [],
  },
  limit: {
    type: Number,
    default: 9,
  },
  maxSizeMb: {
    type: Number,
    default: 10,
  },
  accept: {
    type: String,
    default: 'image/jpeg,image/png,image/webp',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])
const fileList = ref([])
const previewUrl = ref('')
const activeUploads = ref(0)

const urls = computed(() =>
  [...new Set((props.modelValue || []).filter((url) => typeof url === 'string' && url))],
)
const isFull = computed(() => urls.value.length >= props.limit)
const isUploading = computed(() => activeUploads.value > 0)

watch(
  urls,
  (value) => {
    fileList.value = value.map((url, index) => ({
      name: `图片 ${index + 1}`,
      url,
      status: 'success',
      uid: -(index + 1),
    }))
  },
  { immediate: true },
)

function beforeUpload(file) {
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请选择图片文件')
    return false
  }

  if (file.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.error(`单张图片不能超过 ${props.maxSizeMb} MB`)
    return false
  }

  return true
}

async function handleUpload({ file, onError, onSuccess }) {
  activeUploads.value += 1

  try {
    const url = await uploadImage(file)
    emit('update:modelValue', [...urls.value, url])
    onSuccess?.({ url })
  } catch (error) {
    ElMessage.error(error?.message || '图片上传失败，请稍后重试')
    onError?.(error)
  } finally {
    activeUploads.value -= 1
  }
}

function handleRemove(file) {
  emit('update:modelValue', urls.value.filter((url) => url !== file.url))
}

function handlePreview(file) {
  previewUrl.value = file.url
}

function handleExceed() {
  ElMessage.warning(`最多上传 ${props.limit} 张图片`)
}
</script>

<template>
  <div class="image-upload">
    <el-upload
      :class="{ 'image-upload__control--full': isFull }"
      list-type="picture-card"
      :file-list="fileList"
      :accept="accept"
      :limit="limit"
      :disabled="disabled || isUploading"
      :auto-upload="true"
      :http-request="handleUpload"
      :before-upload="beforeUpload"
      :on-remove="handleRemove"
      :on-preview="handlePreview"
      :on-exceed="handleExceed"
      aria-label="上传图片"
    >
      <div class="image-upload__trigger">
        <el-icon><Plus /></el-icon>
        <span>{{ isUploading ? '正在上传' : '上传图片' }}</span>
      </div>

      <template #file="{ file }">
        <img class="image-upload__thumbnail" :src="file.url" :alt="file.name" />
        <span class="image-upload__actions">
          <button type="button" aria-label="预览图片" @click.stop="handlePreview(file)">
            <el-icon><View /></el-icon>
          </button>
          <button
            v-if="!disabled"
            type="button"
            aria-label="删除图片"
            @click.stop="handleRemove(file)"
          >
            <el-icon><Delete /></el-icon>
          </button>
        </span>
      </template>
    </el-upload>

    <p class="image-upload__hint">
      支持 JPG、PNG、WEBP 格式，单张不超过 {{ maxSizeMb }} MB，最多 {{ limit }} 张。
    </p>

    <el-image-viewer
      v-if="previewUrl"
      :url-list="urls"
      :initial-index="urls.indexOf(previewUrl)"
      @close="previewUrl = ''"
    />
  </div>
</template>

<style scoped>
.image-upload {
  width: 100%;
}

.image-upload :deep(.el-upload-list--picture-card) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.image-upload :deep(.el-upload-list--picture-card .el-upload-list__item),
.image-upload :deep(.el-upload--picture-card) {
  width: 120px;
  height: 120px;
  margin: 0;
  border-radius: 6px;
}

.image-upload__control--full :deep(.el-upload--picture-card) {
  display: none;
}

.image-upload__trigger {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.image-upload__trigger .el-icon {
  color: var(--color-primary);
  font-size: 24px;
}

.image-upload__thumbnail {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-upload__actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgb(23 32 51 / 68%);
  opacity: 0;
  transition: opacity var(--motion-fast);
}

.image-upload :deep(.el-upload-list__item:hover) .image-upload__actions,
.image-upload :deep(.el-upload-list__item:focus-within) .image-upload__actions {
  opacity: 1;
}

.image-upload__actions button {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  color: #fff;
  background: transparent;
}

.image-upload__actions button:hover,
.image-upload__actions button:focus-visible {
  background: rgb(255 255 255 / 20%);
}

.image-upload__actions .el-icon {
  font-size: 22px;
}

.image-upload__hint {
  margin: 12px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 480px) {
  .image-upload :deep(.el-upload-list--picture-card) {
    gap: 8px;
  }

  .image-upload :deep(.el-upload-list--picture-card .el-upload-list__item),
  .image-upload :deep(.el-upload--picture-card) {
    width: 104px;
    height: 104px;
  }
}
</style>
