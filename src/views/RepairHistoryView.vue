<script setup>
import { computed } from 'vue'
import RepairWorkOrderWorkspace from '@/components/RepairWorkOrderWorkspace.vue'
import RepairIssueRecordsView from '@/views/RepairIssueRecordsView.vue'
import { ROLE_KEYS } from '@/config/access'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const reporterRole = computed(() =>
  [ROLE_KEYS.STUDENT, ROLE_KEYS.ZONE_ADMIN].includes(auth.currentRole.value),
)
</script>

<template>
  <RepairIssueRecordsView v-if="reporterRole" history-only />
  <RepairWorkOrderWorkspace v-else mode="history" />
</template>
