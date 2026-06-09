<template>
  <div>
    <div class="page-header"><div><h2>Scheduler</h2><p>GIGL sync status and history.</p></div></div>
    <div class="page-card">
      <el-row :gutter="16">
        <el-col :span="6"><div class="stat-box"><div :class="['stat-num', sync.running ? 'text-warn' : (sync.lastResult === 'success' ? 'text-ok' : 'text-err')]">{{ sync.running ? 'Running' : (sync.lastResult || '—') }}</div><div class="stat-label">Status</div></div></el-col>
        <el-col :span="6"><div class="stat-box"><div class="stat-num">{{ sync.lastRun ? fmtTime(sync.lastRun) : '—' }}</div><div class="stat-label">Last Run</div></div></el-col>
        <el-col :span="6"><div class="stat-box"><div class="stat-num">{{ sync.nextRun || '—' }}</div><div class="stat-label">Next Run</div></div></el-col>
        <el-col :span="6"><div class="stat-box"><div class="stat-num" style="font-size:14px">9:00 — 19:00 WAT</div><div class="stat-label">Sync Window</div></div></el-col>
      </el-row>
      <el-button style="margin-top:12px" @click="loadStatus">Refresh</el-button>
      <template v-if="sync.lastStats && Object.keys(sync.lastStats).length">
        <h4 style="margin-top:16px">Last Sync Details</h4>
        <el-descriptions border size="small">
          <el-descriptions-item v-for="(v,k) in sync.lastStats" :key="k" :label="k">{{ v }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'
const sync = ref({})
function fmtTime(d) { if (!d) return '—'; return new Date(d).toLocaleString() }
async function loadStatus() { try { const { data } = await api.get('/gigl/sync-status'); sync.value = data } catch { sync.value = { lastResult: 'error' } } }
onMounted(loadStatus)
</script>

<style scoped>
.stat-box { background:#f5f7fa; padding:16px; border-radius:8px; text-align:center; }
.stat-num { font-size:18px; font-weight:700; color:#303133; }
.stat-label { font-size:12px; color:#909399; margin-top:4px; }
.text-ok { color:#059669; } .text-err { color:#dc2626; } .text-warn { color:#d97706; }
</style>
