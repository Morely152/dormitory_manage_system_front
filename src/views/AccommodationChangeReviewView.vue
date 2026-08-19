<script setup>
import { computed, onMounted, ref } from 'vue'
import { CircleCheck, Close, DocumentChecked, InfoFilled, Loading, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getPendingAccommodationChangeRecords,
  reviewAccommodationExchangeApplication,
} from '@/api/accommodationChangeReview'
import { useNotificationStore } from '@/stores/notifications'

const notificationStore = useNotificationStore()
const loading = ref(false)
const reviewingKey = ref('')
const records = ref([])

const pendingCount = computed(() => records.value.length)

function firstDefined(source, fields) {
  for (const field of fields) {
    const value = source?.[field]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function displayValue(value, fallback = '--') {
  return value === undefined || value === null || value === '' ? fallback : String(value)
}

function applicationTypeLabel(type) {
  if (type === 'MOVE_TO_EMPTY') return '搬入空床位'
  if (type === 'EXCHANGE') return '交换床位'
  return '住宿变更'
}

function normalizeStudentRecord(source) {
  return {
    id: firstDefined(source, ['recordId', 'id']),
    studentName: displayValue(firstDefined(source, ['studentName'])),
    studentNo: displayValue(firstDefined(source, ['studentNo'])),
    collegeName: displayValue(firstDefined(source, ['studentCollegeName', 'collegeName'])),
    className: displayValue(firstDefined(source, ['studentClassName', 'className'])),
    oldLocationText: displayValue(firstDefined(source, ['oldLocationText']), '未提供原住宿位置'),
    newLocationText: displayValue(firstDefined(source, ['newLocationText']), '未提供目标住宿位置'),
  }
}

function normalizeRecord(source, index) {
  const studentRecords = Array.isArray(source.records) ? source.records.map(normalizeStudentRecord) : []
  return {
    id: firstDefined(source, ['applicationKey', 'id', 'applicationId']) ?? `application-${index}`,
    firstBedId: firstDefined(source, ['firstBedId']),
    secondBedId: firstDefined(source, ['secondBedId']),
    applicationType: firstDefined(source, ['applicationType']),
    applicationTypeLabel: applicationTypeLabel(firstDefined(source, ['applicationType'])),
    reason: displayValue(firstDefined(source, ['reason', 'remark', 'applyReason']), '未填写备注'),
    createdAt: displayValue(firstDefined(source, ['createdAt', 'createTime', 'appliedAt']), '未提供时间'),
    effectiveAt: displayValue(firstDefined(source, ['effectiveAt']), '未提供时间'),
    recordCount: Number(firstDefined(source, ['recordCount']) ?? studentRecords.length),
    studentRecords,
  }
}

function unwrapList(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  if (!Array.isArray(response?.data)) throw new Error(fallbackMessage)
  return response.data
}

function unwrapResponse(response, fallbackMessage) {
  if (response?.code !== undefined && response.code !== 0) {
    throw new Error(response.message || fallbackMessage)
  }
  return response?.data
}

function requestErrorMessage(error, fallbackMessage) {
  return error.response?.data?.message || error.message || fallbackMessage
}

async function loadRecords() {
  loading.value = true
  try {
    const rows = unwrapList(await getPendingAccommodationChangeRecords(), '待生效住宿变更记录加载失败')
    records.value = rows.map(normalizeRecord).filter((record) => (
      record.firstBedId !== undefined && record.firstBedId !== null &&
      record.secondBedId !== undefined && record.secondBedId !== null
    ))
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, '待生效住宿变更记录加载失败'))
  } finally {
    loading.value = false
  }
}

async function reviewRecord(approved, record) {
  const action = approved ? '通过' : '驳回'
  const defaultReason = approved ? '宿管中心已通过审核' : '宿管中心已驳回审核'
  let reason = defaultReason

  try {
    const result = await ElMessageBox.prompt('请填写本次审核备注', `确认${action}住宿变更申请`, {
      confirmButtonText: `确认${action}`,
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '请输入审核备注',
      inputValue: defaultReason,
      closeOnClickModal: false,
    })
    reason = String(result.value || '').trim() || defaultReason
  } catch {
    return
  }

  reviewingKey.value = String(record.id)
  try {
    unwrapResponse(await reviewAccommodationExchangeApplication({
      firstBedId: record.firstBedId,
      secondBedId: record.secondBedId,
      type: approved ? 'APPROVE' : 'REJECT',
      reason,
    }), `${action}住宿变更申请失败`)
    ElMessage.success(`住宿变更申请已${action}`)
    await loadRecords()
    await notificationStore.refresh()
  } catch (error) {
    ElMessage.error(requestErrorMessage(error, `${action}住宿变更申请失败`))
  } finally {
    reviewingKey.value = ''
  }
}

onMounted(loadRecords)
</script>

<template>
  <main class="change-review-page">
    <header class="feature-header change-review-page__header">
      <div class="feature-header__icon" aria-hidden="true"><el-icon>
          <DocumentChecked />
        </el-icon></div>
      <div>
        <p>审核处理</p>
        <h1>住宿信息修改审核</h1>
        <span>核对待生效的寝室变更申请；仅宿管中心管理员确认通过后，住宿信息才会正式生效。</span>
      </div>
    </header>

    <section class="change-review-summary" aria-label="待审核申请统计">
      <div><span>待确认申请</span><strong>{{ pendingCount }}</strong><em>条</em></div>
      <p><el-icon aria-hidden="true">
          <InfoFilled />
        </el-icon>请仔细核对原床位与目标床位的学生信息后再执行确认操作。</p>
    </section>

    <section class="change-review-workspace" aria-labelledby="pending-list-title">
      <header class="change-review-workspace__header">
        <div>
          <h2 id="pending-list-title">待生效住宿变更记录</h2>
          <p>展开申请单可查看参与学生的原住宿、目标住宿和申请理由。</p>
        </div>
        <el-button :icon="Refresh" :loading="loading" @click="loadRecords">刷新列表</el-button>
      </header>

      <div class="change-review-table-wrap">
        <el-table v-loading="loading" :data="records" row-key="id" class="change-review-table"
          empty-text="暂无待生效的住宿变更记录">
          <el-table-column type="expand" width="54">
            <template #default="{ row }">
              <div class="change-review-detail">
                <section v-for="(item, itemIndex) in row.studentRecords" :key="item.id || itemIndex"
                  class="change-review-detail__party">
                  <h3>学生 {{ itemIndex + 1 }}</h3>
                  <dl>
                    <div>
                      <dt>姓名 / 学号</dt>
                      <dd>{{ item.studentName }} · {{ item.studentNo }}</dd>
                    </div>
                    <div>
                      <dt>学院 / 班级</dt>
                      <dd>{{ item.collegeName }} · {{ item.className }}</dd>
                    </div>
                    <div>
                      <dt>原住宿位置</dt>
                      <dd>{{ item.oldLocationText }}</dd>
                    </div>
                    <div>
                      <dt>目标住宿位置</dt>
                      <dd>{{ item.newLocationText }}</dd>
                    </div>
                  </dl>
                </section>
                <section class="change-review-detail__reason">
                  <h3>换寝理由</h3>
                  <p>{{ row.reason }}</p>
                </section>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" min-width="120"><template #default="{ row }"><el-tag type="info" effect="plain">{{
            row.applicationTypeLabel }}</el-tag></template></el-table-column>
          <el-table-column label="参与学生" min-width="180" show-overflow-tooltip><template #default="{ row }"><strong
                class="change-review-table__line-list"><template v-for="(item, itemIndex) in row.studentRecords"
                  :key="item.id || itemIndex">{{ item.studentName }}（{{ item.studentNo }}）<br
                     v-if="itemIndex < row.studentRecords.length - 1"></template></strong></template></el-table-column> 
          <el-table-column label="原住宿位置" min-width="240" show-overflow-tooltip><template #default="{ row }">
              <div class="change-review-table__line-list"><template v-for="(item, itemIndex) in row.studentRecords"
                  :key="item.id || itemIndex">{{ item.oldLocationText }}<br
                    v-if="itemIndex < row.studentRecords.length - 1"></template>
              </div>
            </template></el-table-column>
          <el-table-column label="目标住宿位置" min-width="240" show-overflow-tooltip><template #default="{ row }">
              <div class="change-review-table__line-list"><template v-for="(item, itemIndex) in row.studentRecords"
                  :key="item.id || itemIndex">{{ item.newLocationText }}<br
                    v-if="itemIndex < row.studentRecords.length - 1"></template>
              </div>
            </template></el-table-column>
          <el-table-column label="换寝理由" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.reason
              }}</template></el-table-column>
          <el-table-column label="提交时间" min-width="170"><template #default="{ row }">{{ row.createdAt
              }}</template></el-table-column>
          <el-table-column label="审核操作" width="190" fixed="right">
            <template #default="{ row }">
              <div class="change-review-actions">
                <el-button type="success" :icon="CircleCheck" :loading="reviewingKey === String(row.id)"
                  :disabled="Boolean(reviewingKey)" @click="reviewRecord(true, row)">通过</el-button>
                <el-button type="danger" :icon="Close" :disabled="Boolean(reviewingKey)"
                  @click="reviewRecord(false, row)">驳回</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="loading" class="change-review-mobile-state"><el-icon>
          <Loading />
        </el-icon>正在加载待审核记录</div>
      <div v-else-if="!records.length" class="change-review-mobile-state"><el-icon>
          <DocumentChecked />
        </el-icon>
        <div><strong>暂无待确认申请</strong><span>当前没有需要宿管中心管理员确认的住宿变更记录。</span></div>
      </div>
      <div v-else class="change-review-mobile-list">
        <article v-for="record in records" :key="record.id" class="change-review-mobile-card">
          <header>
            <div>
              <h3>待确认住宿变更</h3><span>{{ record.createdAt }}</span>
            </div>
          </header>
          <section v-for="(item, itemIndex) in record.studentRecords" :key="item.id || itemIndex">
            <h4>学生 {{ itemIndex + 1 }}</h4>
            <p>{{ item.studentName }} · {{ item.studentNo }}</p>
            <p>{{ item.collegeName }} · {{ item.className }}</p>
            <p>原住宿：{{ item.oldLocationText }}</p>
            <p>目标住宿：{{ item.newLocationText }}</p>
          </section>
          <section>
            <h4>换寝理由</h4>
            <p>{{ record.reason }}</p>
          </section>
          <footer class="change-review-actions">
            <el-button type="success" :icon="CircleCheck" :loading="reviewingKey === String(record.id)"
              :disabled="Boolean(reviewingKey)" @click="reviewRecord(true, record)">通过</el-button>
            <el-button type="danger" :icon="Close" :disabled="Boolean(reviewingKey)"
              @click="reviewRecord(false, record)">驳回</el-button>
          </footer>
        </article>
      </div>
    </section>
  </main>
</template>

<style scoped>
.change-review-page {
  display: grid;
  gap: 20px;
}

.change-review-page__header {
  margin: 0;
}

.change-review-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 24px;
  border: 1px solid #bed1f6;
  border-radius: 10px;
  background: #f5f8ff;
}

.change-review-summary>div {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.change-review-summary span {
  color: #36547e;
  font-size: 14px;
  font-weight: 600;
}

.change-review-summary strong {
  color: var(--color-primary);
  font-size: 32px;
  font-variant-numeric: tabular-nums;
}

.change-review-summary em {
  color: #36547e;
  font-size: 14px;
  font-style: normal;
}

.change-review-summary p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: #36547e;
  font-size: 14px;
  line-height: 1.6;
}

.change-review-workspace {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.change-review-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 24px 16px;
}

.change-review-workspace__header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 19px;
}

.change-review-workspace__header p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.change-review-workspace__header .el-button {
  min-height: 44px;
}

.change-review-table-wrap {
  border-top: 1px solid var(--color-border);
}

.change-review-table :deep(.el-table__cell) {
  padding: 13px 0;
}

.change-review-table strong,
.change-review-table span {
  display: block;
}

.change-review-table strong {
  color: var(--color-text);
  font-size: 14px;
}

.change-review-table span {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.change-review-table__line-list {
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.change-review-detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 20px 28px;
  background: #fafbfd;
}

.change-review-detail__party,
.change-review-detail__reason {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: #fff;
}

.change-review-detail__reason {
  grid-column: span 2;
}

.change-review-detail h3 {
  margin: 0 0 12px;
  color: var(--color-text);
  font-size: 15px;
}

.change-review-detail dl {
  display: grid;
  gap: 9px;
  margin: 0;
}

.change-review-detail dt {
  color: var(--color-text-muted);
  font-size: 12px;
}

.change-review-detail dd {
  margin: 4px 0 0;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.change-review-detail__reason p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.change-review-actions {
  display: flex;
  gap: 8px;
}

.change-review-actions .el-button {
  min-height: 36px;
  margin: 0;
}

.change-review-mobile-list,
.change-review-mobile-state {
  display: none;
}

@media (max-width: 760px) {
  .change-review-summary {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
  }

  .change-review-table-wrap {
    display: none;
  }

  .change-review-mobile-list {
    display: grid;
    gap: 12px;
    padding: 16px;
    border-top: 1px solid var(--color-border);
  }

  .change-review-mobile-card {
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: #fff;
  }

  .change-review-mobile-card>header,
  .change-review-mobile-card>section {
    padding: 16px;
  }

  .change-review-mobile-card>section,
  .change-review-mobile-card>footer {
    border-top: 1px solid var(--color-border);
  }

  .change-review-mobile-card h3,
  .change-review-mobile-card h4 {
    margin: 10px 0 0;
    color: var(--color-text);
    font-size: 15px;
  }

  .change-review-mobile-card h4 {
    margin: 0 0 8px;
    font-size: 14px;
  }

  .change-review-mobile-card header span,
  .change-review-mobile-card p {
    display: block;
    margin: 5px 0 0;
    color: var(--color-text-secondary);
    font-size: 13px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .change-review-mobile-state {
    min-height: 220px;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .change-review-mobile-state .el-icon {
    color: var(--color-primary);
    font-size: 24px;
  }

  .change-review-mobile-state strong,
  .change-review-mobile-state span {
    display: block;
  }

  .change-review-mobile-state strong {
    color: var(--color-text);
    font-size: 15px;
  }

  .change-review-mobile-state span {
    margin-top: 5px;
    font-size: 14px;
    line-height: 1.6;
  }

  .change-review-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding: 16px;
  }

  .change-review-actions .el-button {
    width: 100%;
    min-height: 44px;
  }
}

@media (max-width: 420px) {
  .change-review-workspace__header {
    align-items: stretch;
    flex-direction: column;
    padding: 20px 16px 16px;
  }

  .change-review-workspace__header .el-button {
    width: 100%;
  }
}
</style>
