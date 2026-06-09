<template>
  <div>
    <div class="page-header">
      <div><h2>Products</h2><p>Manage product catalog, pricing and availability.</p></div>
      <el-button v-if="isAdmin" class="btn-dark" @click="openCreate">+ New Product</el-button>
    </div>
    <div class="page-card">

    <div style="margin-bottom:12px">
      <el-input v-model="search" placeholder="Search by code or name..." clearable style="width:300px" @keyup.enter="loadProducts">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button size="small" class="btn-search" style="margin-left:8px" @click="loadProducts">Search</el-button>
    </div>

    <el-table :data="products" stripe v-loading="loading" @sort-change="onSortChange">
      <el-table-column prop="sort_order" label="#" width="50" />
      <el-table-column prop="code" label="Code" width="120" sortable="custom" />
      <el-table-column prop="name" label="Name" min-width="180" />
      <el-table-column label="Price" width="120"><template #default="{row}">₦{{ Number(row.price).toLocaleString() }}</template></el-table-column>
      <el-table-column v-if="isAdmin" label="Cost" width="120"><template #default="{row}">₦{{ Number(row.cost || 0).toLocaleString() }}</template></el-table-column>
      <el-table-column label="Status" width="100"><template #default="{row}"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? 'Active' : 'Inactive' }}</el-tag></template></el-table-column>
      <el-table-column v-if="isAdmin" label="Actions" width="180" fixed="right">
        <template #default="{row, $index}">
          <el-button link type="primary" size="small" :disabled="$index === 0" @click="moveUp($index)">↑</el-button>
          <el-button link type="primary" size="small" :disabled="$index === products.length - 1" @click="moveDown($index)">↓</el-button>
          <el-button link type="primary" size="small" @click="openEdit(row)">Edit</el-button>
          <el-popconfirm title="Delete?" @confirm="handleDelete(row.id)"><template #reference><el-button link type="danger" size="small">Del</el-button></template></el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <div style="margin-top:12px;text-align:right">
      <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @size-change="loadProducts" @current-change="loadProducts" />
    </div>

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="showDialog" :title="editing ? 'Edit Product' : 'New Product'" width="500px">
      <el-form label-position="top">
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="Sort Order"><el-input-number v-model="form.sort_order" :min="0" style="width:100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="Code" required><el-input v-model="form.code" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="Status"><el-select v-model="form.status"><el-option label="Active" value="active" /><el-option label="Inactive" value="inactive" /></el-select></el-form-item></el-col>
        </el-row>
        <el-form-item label="Name" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="Price" required><el-input-number v-model="form.price" :min="0" :step="500" style="width:100%" /></el-form-item>
        <el-form-item v-if="isAdmin" label="Cost" required><el-input-number v-model="form.cost" :min="0" :step="500" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">Cancel</el-button>
        <el-button type="primary" @click="handleSave">Save</el-button>
      </template>
    </el-dialog>
  </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'
import { getUser } from '../utils/auth'

const isAdmin = ref(getUser()?.role === 'admin')
const loading = ref(false)
const products = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const sortBy = ref('')
const sortDir = ref('')
const search = ref('')

async function onSortChange({ prop, order }) {
  if (!prop || !order) return
  // Fetch all products sorted by code, then reorder
  const { data } = await api.get('/products', { params: { page_size: 1000, sort_by: 'code', sort_dir: order === 'ascending' ? 'asc' : 'desc' } })
  await api.post('/products/reorder', { order: data.list.map(p => p.id) })
  loadProducts()
}
const showDialog = ref(false)
const editing = ref(null)
const form = ref({ sort_order: 0, code: '', name: '', price: 0, cost: 0, status: 'active' })

async function loadProducts() {
  loading.value = true
  const params = { page: page.value, page_size: pageSize.value }
  if (search.value) params.search = search.value
  if (sortBy.value) { params.sort_by = sortBy.value; params.sort_dir = sortDir.value }
  const { data } = await api.get('/products', { params })
  products.value = data.list; total.value = data.total; loading.value = false
}

function openCreate() { editing.value = null; form.value = { sort_order: products.value.length + 1, code: '', name: '', price: 0, cost: 0, status: 'active' }; showDialog.value = true }
function openEdit(p) { editing.value = p; form.value = { sort_order: p.sort_order, code: p.code, name: p.name, price: p.price, cost: p.cost || 0, status: p.status }; showDialog.value = true }

async function handleSave() {
  if (!form.value.code || !form.value.name || !form.value.price || form.value.cost == null) { ElMessage.warning('All fields required'); return }
  const p = { ...form.value, price: parseFloat(form.value.price), cost: parseFloat(form.value.cost) }
  try {
    if (editing.value) { await api.put(`/products/${editing.value.id}`, p) }
    else {
      await api.post('/products', p)
      // Fetch all and reorder sequentially
      const { data } = await api.get('/products', { params: { page_size: 10000 } })
      await api.post('/products/reorder', { order: data.list.map(x => x.id) })
    }
    ElMessage.success('Saved'); showDialog.value = false; loadProducts()
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
}

async function handleDelete(id) { await api.delete(`/products/${id}`); loadProducts() }

async function moveUp(idx) {
  const a = products.value[idx], b = products.value[idx-1]
  await api.put(`/products/${a.id}`, { ...a, sort_order: b.sort_order })
  await api.put(`/products/${b.id}`, { ...b, sort_order: a.sort_order })
  loadProducts()
}

async function moveDown(idx) {
  const a = products.value[idx], b = products.value[idx+1]
  await api.put(`/products/${a.id}`, { ...a, sort_order: b.sort_order })
  await api.put(`/products/${b.id}`, { ...b, sort_order: a.sort_order })
  loadProducts()
}

onMounted(loadProducts)
</script>
