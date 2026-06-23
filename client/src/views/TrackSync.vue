<template>
  <div>
    <div class="page-header"><div><h2>Track Sync</h2><p>Query Speedaf tracking status and sync if mismatched.</p></div></div>
    <div class="page-card">
      <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center">
        <el-input v-model="billCode" placeholder="Enter Speedaf tracking number..." clearable style="width:300px" @keyup.enter="search" />
        <el-button type="primary" @click="search" :loading="loading">Search</el-button>
      </div>

      <template v-if="result">
        <el-descriptions :column="2" border size="small" style="margin-bottom:16px">
          <el-descriptions-item label="Bill Code">{{ result.billCode }}</el-descriptions-item>
          <el-descriptions-item label="Speedaf Status">
            <el-tag :type="tagFor(result.speedafStatus)">{{ result.speedafStatus || 'Unknown' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="Local Status">
            <el-tag :type="tagFor(result.localStatus)">{{ result.localStatus || 'Not found' }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="Match">
            <span :style="{color: result.matched ? '#67c23a' : '#f56c6c', fontWeight:'600'}">{{ result.matched ? '✓ Synced' : '✗ Mismatch' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="Last Event" :span="2">{{ result.lastEvent || '-' }}</el-descriptions-item>
        </el-descriptions>
        <el-button v-if="!result.matched && result.speedafStatus" type="warning" @click="sync" :loading="syncing">
          Sync to Speedaf Status
        </el-button>
      </template>
      <p v-else-if="searched && !loading" style="color:var(--fg-muted)">No result</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const billCode = ref('')
const loading = ref(false)
const syncing = ref(false)
const searched = ref(false)
const result = ref(null)

function tagFor(s) {
  return { pending:'warning', in_transit:'primary', delivered:'success', returned:'danger', returning:'warning', cancelled:'danger', voided:'info' }[s] || 'info'
}

async function search() {
  if (!billCode.value.trim()) return
  loading.value = true; searched.value = true; result.value = null
  try {
    const { data } = await api.get(`/speedaf/track/${billCode.value.trim()}`)
    result.value = data
  } catch (e) {
    ElMessage.error('Query failed')
  } finally { loading.value = false }
}

async function sync() {
  syncing.value = true
  try {
    await api.post(`/speedaf/sync`, { billCode: billCode.value.trim() })
    ElMessage.success('Synced')
    search()
  } catch (e) { ElMessage.error('Sync failed') }
  finally { syncing.value = false }
}
</script>
