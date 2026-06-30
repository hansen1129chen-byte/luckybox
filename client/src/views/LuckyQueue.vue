<template>
  <div>
    <div class="page-header">
      <div>
        <h2>Lucky Draw Queue</h2>
        <p>Manage blind box orders — reorder queue, place orders.</p>
      </div>
    </div>
    <div class="page-card">
      <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center">
        <el-button size="small" @click="loadQueue">Refresh</el-button>
        <span style="color:var(--fg-muted);font-size:13px">{{ list.length }} waiting</span>
      </div>

      <el-table :data="list" stripe v-loading="loading" row-key="id" @row-click="()=>{}">
        <el-table-column label="#" width="50">
          <template #default="{ $index }">
            <span :style="{ fontWeight: $index === 0 ? '700' : '', color: $index === 0 ? 'var(--primary)' : '' }">
              {{ $index + 1 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="customer_name" label="Name" min-width="140" />
        <el-table-column prop="customer_phone" label="Phone" width="130" />
        <el-table-column prop="accept_province" label="State" width="90" />
        <el-table-column prop="customer_address" label="Address" min-width="180" show-overflow-tooltip />
        <el-table-column label="Box" width="80">
          <template #default="{ row }">
            <el-tag :type="row.blind_box_type === '50k' ? 'warning' : 'info'" size="small">
              {{ row.blind_box_type === '50k' ? '50K' : '20K' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" label="Amount" width="100">
          <template #default="{ row }">₦{{ Number(row.amount).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="Created" width="110">
          <template #default="{ row }">{{ row.created_at?.slice(0,10) }}</template>
        </el-table-column>
        <el-table-column label="Actions" width="200" fixed="right">
          <template #default="{ row, $index }">
            <el-button link type="primary" size="small" @click="openOrderDialog(row)">Order</el-button>
            <el-button link size="small" :disabled="$index === 0" @click="moveUp(row, $index)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
            </el-button>
            <el-button link size="small" :disabled="$index === list.length - 1" @click="moveDown(row, $index)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="list.length === 0 && !loading" style="text-align:center;padding:48px;color:var(--fg-muted)">
        No players in queue. When someone buys a blind box, they'll appear here.
      </div>
    </div>

    <!-- Order Dialog -->
    <el-dialog v-model="showOrder" title="Place Order" width="420px">
      <template v-if="orderTarget">
        <el-descriptions :column="1" border size="small" style="margin-bottom:16px">
          <el-descriptions-item label="Name">{{ orderTarget.customer_name }}</el-descriptions-item>
          <el-descriptions-item label="Phone">{{ orderTarget.customer_phone }}</el-descriptions-item>
          <el-descriptions-item label="Box">{{ orderTarget.blind_box_type === '50k' ? 'Gold (₦50,000)' : 'Silver (₦20,000)' }}</el-descriptions-item>
          <el-descriptions-item label="State">{{ orderTarget.accept_province }}</el-descriptions-item>
          <el-descriptions-item label="Address">{{ orderTarget.customer_address }}</el-descriptions-item>
        </el-descriptions>

        <el-form label-position="top">
          <el-form-item label="Streamer">
            <el-select v-model="orderForm.streamer_name" filterable allow-create placeholder="Select or type streamer name" style="width:100%">
              <el-option v-for="s in streamers" :key="s.id" :label="s.name" :value="s.name" />
            </el-select>
          </el-form-item>
          <div v-if="orderForm.streamer_name" style="font-size:12px;color:var(--fg-muted);margin-top:-8px;margin-bottom:12px">
            Commission: <el-input-number v-model="orderForm.commission_rate" :min="0" :max="100" size="small" style="width:80px" /> %
          </div>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="showOrder = false">Cancel</el-button>
        <el-button type="primary" :disabled="!orderForm.streamer_name" @click="confirmOrder">Confirm Order</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const list = ref([])
const loading = ref(false)
const streamers = ref([])
const showOrder = ref(false)
const orderTarget = ref(null)
const orderForm = ref({ streamer_name: '', commission_rate: 0 })

async function loadQueue() {
  loading.value = true
  try {
    const { data } = await api.get('/lucky-draw/queue')
    list.value = data.list || []
  } catch { ElMessage.error('Failed to load queue') }
  finally { loading.value = false }
}

async function loadStreamers() {
  try {
    const { data } = await api.get('/config/streamers')
    streamers.value = data
  } catch {}
}

async function openOrderDialog(row) {
  orderTarget.value = row
  orderForm.value = { streamer_name: '', commission_rate: 0 }
  showOrder.value = true
  // Auto-fill last streamer for this phone
  try {
    const { data } = await api.get(`/lucky-draw/queue/last-streamer/${row.customer_phone}`)
    if (data.streamer_name) {
      orderForm.value.streamer_name = data.streamer_name
      const s = streamers.value.find(st => st.name === data.streamer_name)
      if (s) orderForm.value.commission_rate = s.commission_rate || 0
    }
  } catch {}
}

async function confirmOrder() {
  try {
    await api.post(`/lucky-draw/queue/${orderTarget.value.id}/order`, orderForm.value)
    ElMessage.success('Order created: ' + orderTarget.value.customer_name)
    showOrder.value = false
    loadQueue()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

async function reorderItems(items) {
  try { await api.put('/lucky-draw/queue/reorder', { items }) }
  catch { ElMessage.error('Reorder failed') }
}

async function moveUp(row, index) {
  if (index === 0) return
  const arr = [...list.value]
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
  list.value = arr
  const items = arr.map((r, i) => ({ id: r.id, queue_position: i + 1 }))
  await reorderItems(items)
}

async function moveDown(row, index) {
  if (index === list.value.length - 1) return
  const arr = [...list.value]
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
  list.value = arr
  const items = arr.map((r, i) => ({ id: r.id, queue_position: i + 1 }))
  await reorderItems(items)
}

onMounted(() => { loadQueue(); loadStreamers() })
</script>
