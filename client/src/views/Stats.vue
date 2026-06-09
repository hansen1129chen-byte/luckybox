<template>
  <div>
    <div class="page-header"><div><h2>Statistics</h2><p>Sales overview, streamer commissions and product performance.</p></div></div>
    <div class="page-card">

    <el-form :inline="true" style="margin-bottom:16px">
      <el-form-item label="Period"><el-date-picker v-model="filters.dates" type="daterange" range-separator="-" start-placeholder="From" end-placeholder="To" value-format="YYYY-MM-DD" /></el-form-item>
      <el-form-item><el-button class="btn-search" @click="loadAll">Search</el-button></el-form-item>
    </el-form>

    <el-tabs>
      <!-- Sales Overview -->
      <el-tab-pane label="Sales Overview">
        <el-row :gutter="16" style="margin-bottom:16px">
          <el-col :span="6"><div class="stat-box"><div class="stat-num">{{ sales.total_orders || 0 }}</div><div class="stat-label">Total Orders</div></div></el-col>
          <el-col :span="6"><div class="stat-box"><div class="stat-num">₦{{ Number(sales.total_sales || 0).toLocaleString() }}</div><div class="stat-label">Total Sales</div></div></el-col>
          <el-col :span="6"><div class="stat-box"><div class="stat-num">₦{{ Number(sales.total_actual || 0).toLocaleString() }}</div><div class="stat-label">Actual Receipts</div></div></el-col>
          <el-col :span="6"><div class="stat-box"><div class="stat-num">₦{{ Number((sales.total_sales || 0) - (sales.total_actual || 0)).toLocaleString() }}</div><div class="stat-label">Difference</div></div></el-col>
        </el-row>
      </el-tab-pane>

      <!-- Commission -->
      <el-tab-pane label="Streamer Commission">
        <el-table :data="commissions" stripe size="small">
          <el-table-column prop="name" label="Streamer" />
          <el-table-column prop="commission_rate" label="Rate" width="80"><template #default="{row}">{{ row.commission_rate }}%</template></el-table-column>
          <el-table-column prop="order_count" label="Orders" width="80" />
          <el-table-column label="Total Sales" width="140"><template #default="{row}">₦{{ Number(row.total_sales).toLocaleString() }}</template></el-table-column>
          <el-table-column label="Commission" width="140"><template #default="{row}"><b>₦{{ Number(row.commission).toLocaleString() }}</b></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Hot Products -->
      <el-tab-pane label="Hot Products">
        <el-table :data="hotProducts" stripe size="small">
          <el-table-column prop="product_code" label="Code" width="110" />
          <el-table-column prop="product_name" label="Product" />
          <el-table-column prop="total_qty" label="Qty Sold" width="100" />
          <el-table-column prop="order_count" label="Orders" width="80" />
          <el-table-column label="Revenue" width="140"><template #default="{row}"><b>₦{{ Number(row.total_sales).toLocaleString() }}</b></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import api from '../api'

const filters = ref({ dates: null })
const sales = ref({})
const commissions = ref([])
const hotProducts = ref([])

function getParams() {
  const p = {}
  if (filters.value.dates) { p.date_from = filters.value.dates[0]; p.date_to = filters.value.dates[1] }
  return p
}

async function loadAll() {
  const params = getParams()
  const [s, c, h] = await Promise.all([
    api.get('/stats/sales', { params }),
    api.get('/stats/commission', { params }),
    api.get('/stats/products', { params })
  ])
  sales.value = s.data; commissions.value = c.data; hotProducts.value = h.data
}

onMounted(loadAll)
</script>

<style scoped>
.stat-box { background:#f5f7fa; padding:20px; border-radius:8px; text-align:center; }
.stat-num { font-size:22px; font-weight:700; color:#303133; }
.stat-label { font-size:12px; color:#909399; margin-top:4px; }
</style>
