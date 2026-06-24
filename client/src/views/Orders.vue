<template>
  <div>
    <div class="page-header">
      <div>
        <h2>Orders</h2>
        <p>Manage all customer orders, payments and fulfillment status.</p>
      </div>
      <div style="display:flex;gap:8px">
        <el-button @click="doRefresh" :loading="refreshing" :disabled="refreshCooldown > 0">{{ refreshCooldown > 0 ? 'Wait '+refreshCooldown+'s' : 'Refresh' }}</el-button>
        <el-button @click="exportCSV" :disabled="!selectedRows.length">Export Excel</el-button>
        <el-button class="btn-dark" @click="$router.push('/lucky_box/orders/new')">+ New Order</el-button>
      </div>
    </div>
    <div class="page-card">

    <!-- Filters -->
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
      <el-date-picker v-model="filters.date_from" type="date" placeholder="From" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <span style="color:var(--fg-muted)">~</span>
      <el-date-picker v-model="filters.date_to" type="date" placeholder="To" value-format="YYYY-MM-DD" size="small" style="width:135px" />
      <el-select v-model="filters.product_names" placeholder="Product" clearable filterable multiple collapse-tags collapse-tags-tooltip size="small" style="width:240px">
        <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.name" />
      </el-select>
      <el-select v-model="filters.streamer_id" placeholder="Streamer" clearable size="small" style="width:120px">
        <el-option v-for="s in streamers" :key="s.id" :label="s.name" :value="s.id" />
      </el-select>
      <el-select v-model="filters.payment_status_id" placeholder="Payment" clearable size="small" style="width:120px">
        <el-option v-for="p in payStatuses" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-button size="small" class="btn-search" @click="loadOrders">Search</el-button>
    </div>

    <!-- Table -->
    <el-table :data="orders" stripe v-loading="loading" style="width:100%" @selection-change="val => selectedRows = val">
      <el-table-column type="selection" width="40" />
      <el-table-column prop="order_no" label="Order No." width="130" />
      <el-table-column prop="customer_name" label="Customer" min-width="140" />
      <el-table-column prop="customer_phone" label="Phone" width="130" />
      <el-table-column prop="customer_address" label="Address" min-width="200" show-overflow-tooltip />
      <el-table-column prop="streamer_name" label="Streamer" width="100" />
      <el-table-column label="Items" width="70">
        <template #default="{row}">{{ row.product_count || 0 }}</template>
      </el-table-column>
      <el-table-column label="Payment" width="100">
        <template #default="{row}">
          <el-tag :type="row.payment_status_name === 'PAID' ? 'success' : 'danger'" size="small">{{ row.payment_status_name }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Tracking" width="140">
        <template #default="{row}">
          <span v-if="row.delivery_method === 'speedaf'" style="font-size:12px;color:var(--primary)">{{ row.gig_tracking || '-' }}</span>
          <span v-else-if="row.delivery_method === 'other'">{{ row.delivery_staff_name || '-' }}</span>
          <span v-else style="color:#909399">-</span>
        </template>
      </el-table-column>
      <el-table-column label="Ship Status" width="120">
        <template #default="{row}">
          <el-tag :type="shipTag(row.shipping_status)" size="small">{{ shipLabel(row.shipping_status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Overtime" width="90">
        <template #default="{row}">
          <span v-if="row.overtime_hours != null" :style="{ color: row.is_overtime ? '#f56c6c' : '', fontWeight: row.is_overtime ? '600' : '' }">{{ fmtOvertime(row.overtime_hours) }}</span>
          <span v-else style="color:#909399">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="total_amount" label="Total" width="100">
        <template #default="{row}">{{ '₦' + Number(row.total_amount).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column prop="actual_amount" label="Actual" width="100">
        <template #default="{row}">{{ '₦' + Number(row.actual_amount).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="Order Time" width="110">
        <template #default="{row}">{{ (row.order_time || row.created_at)?.slice(0,10) }}</template>
      </el-table-column>
      <el-table-column label="Created" width="110">
        <template #default="{row}">{{ row.created_at?.slice(0,10) }}</template>
      </el-table-column>
      <el-table-column label="Actions" width="140" fixed="right">
        <template #default="{row}">
          <el-button link type="primary" size="small" @click="$router.push(`/lucky_box/orders/${row.id}/edit`)">Edit</el-button>
          <el-button link type="primary" size="small" @click="viewDetail(row)">View</el-button>
          <el-button v-if="row.delivery_method === 'speedaf' && row.gig_tracking" link type="warning" size="small" @click="printLabel(row)">Label</el-button>
          <el-popconfirm v-if="isAdmin" title="Delete?" @confirm="handleDelete(row.id)">
            <template #reference><el-button link type="danger" size="small">Del</el-button></template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;text-align:right">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @size-change="loadOrders" @current-change="loadOrders" />
    </div>

    <!-- File Preview Dialog -->
    <el-dialog v-model="showFilePreview" title="Preview" width="80%" top="5vh" @close="previewUrl = ''">
      <template v-if="previewUrl">
        <iframe v-if="previewUrl.endsWith('.pdf') || previewUrl.includes('.pdf')" :src="previewUrl" style="width:100%;height:70vh;border:none" />
        <img v-else :src="previewUrl" style="max-width:100%;max-height:70vh;display:block;margin:0 auto" />
      </template>
    </el-dialog>

    <!-- Detail Dialog -->
    <el-dialog v-model="showDetail" title="Order Detail" width="600px">
      <template v-if="currentOrder">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="Order No.">{{ currentOrder.order_no }}</el-descriptions-item>
          <el-descriptions-item label="Customer">{{ currentOrder.customer_name }}</el-descriptions-item>
          <el-descriptions-item label="Phone">{{ currentOrder.customer_phone }}</el-descriptions-item>
          <el-descriptions-item label="Phone 2">{{ currentOrder.customer_phone2 || '-' }}</el-descriptions-item>
          <el-descriptions-item label="Gender">{{ currentOrder.customer_gender }}</el-descriptions-item>
          <el-descriptions-item label="Province">{{ currentOrder.accept_province || 'LAGOS' }}</el-descriptions-item>
          <el-descriptions-item label="City">{{ currentOrder.accept_city || 'LAGOS' }}</el-descriptions-item>
          <el-descriptions-item label="District">{{ currentOrder.accept_district || 'LAGOS' }}</el-descriptions-item>
          <el-descriptions-item label="Address" :span="2">{{ currentOrder.customer_address }}</el-descriptions-item>
          <el-descriptions-item label="Streamer">{{ currentOrder.streamer_name }}</el-descriptions-item>
          <el-descriptions-item label="Payment">{{ currentOrder.payment_status_name }}</el-descriptions-item>
          <el-descriptions-item label="Total">₦{{ Number(currentOrder.total_amount).toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="Actual">₦{{ Number(currentOrder.actual_amount).toLocaleString() }}</el-descriptions-item>
          <el-descriptions-item label="Shipping"><el-tag :type="shipTag(currentOrder.shipping_status)" size="small">{{ shipLabel(currentOrder.shipping_status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="Order Time">{{ fmtDate(currentOrder.order_time || currentOrder.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="Created">{{ fmtDateTime(currentOrder.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="Updated" :span="2">{{ fmtDateTime(currentOrder.updated_at) }}</el-descriptions-item>
        </el-descriptions>
        <h4 style="margin:12px 0 8px">Items</h4>
        <el-table :data="currentOrder.items" size="small">
          <el-table-column prop="product_code" label="Code" width="120" />
          <el-table-column prop="product_name" label="Product" />
          <el-table-column prop="unit_price" label="Price" width="100"><template #default="{row}">₦{{ Number(row.unit_price).toLocaleString() }}</template></el-table-column>
          <el-table-column prop="quantity" label="Qty" width="60" />
          <el-table-column prop="subtotal" label="Subtotal" width="110"><template #default="{row}">₦{{ Number(row.subtotal).toLocaleString() }}</template></el-table-column>
        </el-table>

        <!-- Payment Proofs -->
        <template v-if="paymentProofs.length > 0">
          <h4 style="margin:12px 0 8px">Payment Proof</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <div v-for="(url, idx) in paymentProofs" :key="idx" style="width:120px;height:100px;border:1px solid var(--border);border-radius:4px;overflow:hidden;background:var(--bg);cursor:pointer" @click="previewUrl = url; showFilePreview = true">
              <template v-if="url.endsWith('.pdf') || url.includes('.pdf')">
                <iframe :src="url" style="width:100%;height:100%;border:none;pointer-events:none" scrolling="no" />
              </template>
              <img v-else :src="url" style="width:100%;height:100%;object-fit:cover" />
            </div>
          </div>
        </template>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import api from '../api'
import { getUser, getToken } from '../utils/auth'

const loading = ref(false)
const orders = ref([])
const streamers = ref([])
const payStatuses = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const isAdmin = ref(getUser()?.role === 'admin')
const products = ref([])
function defaultDateFrom() { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10) }
function defaultDateTo() { return new Date().toISOString().slice(0,10) }
const filters = ref({ date_from: defaultDateFrom(), date_to: defaultDateTo(), streamer_id: null, payment_status_id: null, product_names: [] })
const selectedRows = ref([])
const showDetail = ref(false)
const showFilePreview = ref(false)
const previewUrl = ref('')
const currentOrder = ref(null)

async function loadStreamers() { const { data } = await api.get('/config/streamers'); streamers.value = data }
async function loadPayStatuses() { const { data } = await api.get('/config/payment_statuses'); payStatuses.value = data }

async function loadOrders() {
  loading.value = true
  const params = { page: page.value, page_size: pageSize.value }
  if (filters.value.date_from) params.date_from = filters.value.date_from
  if (filters.value.date_to) params.date_to = filters.value.date_to
  if (filters.value.streamer_id) params.streamer_id = filters.value.streamer_id
  if (filters.value.payment_status_id) params.payment_status_id = filters.value.payment_status_id
  if (filters.value.product_names && filters.value.product_names.length > 0) params.product_names = filters.value.product_names.join(',')
  const { data } = await api.get('/orders', { params })
  orders.value = data.list; total.value = data.total; loading.value = false
}

async function printLabel(row) {
  try {
    const { data } = await api.post(`/speedaf/print/${row.gig_tracking}`)
    if (data.url) { window.open(data.url, '_blank') }
    else if (data.labelUrl) { window.open(data.labelUrl, '_blank') }
    else { ElMessage.warning('Label not available') }
  } catch (err) { ElMessage.error('Failed to fetch label') }
}

async function viewDetail(row) {
  const { data } = await api.get(`/orders/${row.id}`); currentOrder.value = data; showDetail.value = true
}

const paymentProofs = computed(() => {
  const raw = currentOrder.value?.payment_image
  return raw ? raw.split(',').filter(Boolean) : []
})

function fmtOvertime(h) { if (h == null) return '-'; if (h >= 24) { const d = Math.floor(h / 24); const hr = Math.floor(h % 24); return hr > 0 ? d + 'd' + hr + 'h' : d + 'd' } return h >= 1 ? Math.floor(h) + 'h' : Math.round(h * 60) + 'm' }
function shipLabel(s) { return { unassigned:'Unassigned', pending:'Pending', in_transit:'In Transit', delivered:'Delivered', returned:'Returned', returning:'Returning', cancelled:'Cancelled', voided:'Voided' }[s] || s || '-' }
function shipTag(s) { return { unassigned:'info', pending:'warning', in_transit:'primary', delivered:'success', returned:'danger', returning:'warning', cancelled:'danger', voided:'info' }[s] || 'info' }
function fmtDate(d) { if (!d) return '-'; return new Date(d).toLocaleDateString('en-CA') }
function fmtDateTime(d) { if (!d) return '-'; const t = new Date(d); return t.toLocaleDateString('en-CA') + ' ' + t.toTimeString().slice(0,8) }

// Refresh with 60s throttle
const refreshing = ref(false)
const refreshCooldown = ref(0)
const lastRefreshKey = 'lp_last_refresh'
function doRefresh() {
  const now = Date.now()
  const last = parseInt(localStorage.getItem(lastRefreshKey) || '0')
  const elapsed = Math.floor((now - last) / 1000)
  if (elapsed < 60) {
    refreshCooldown.value = 60 - elapsed
    const timer = setInterval(() => { refreshCooldown.value--; if (refreshCooldown.value <= 0) clearInterval(timer) }, 1000)
    return
  }
  refreshing.value = true
  localStorage.setItem(lastRefreshKey, String(now))
  loadOrders().then(() => { refreshing.value = false })
}

function exportCSV() {
  if (!selectedRows.value.length) return
  const ids = selectedRows.value.map(r => r.id).join(',')
  const params = new URLSearchParams()
  if (filters.value.date_from) params.set('date_from', filters.value.date_from)
  if (filters.value.date_to) params.set('date_to', filters.value.date_to)
  if (filters.value.product_names?.length) params.set('product_names', filters.value.product_names.join(','))
  params.set('ids', ids)
  params.set('token', getToken())
  window.open('/lucky_box/api/orders/export?' + params.toString(), '_blank')
}

async function handleDelete(id) { await api.delete(`/orders/${id}`); loadOrders() }

async function loadProducts() { const { data } = await api.get('/products', { params: { page_size: 1000 } }); products.value = data.list }

onMounted(() => { loadStreamers(); loadPayStatuses(); loadProducts(); loadOrders() })
</script>

