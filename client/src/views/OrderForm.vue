<template>
  <div>
    <div class="page-header"><div><h2>{{ isEdit ? 'Edit Order' : 'New Order' }}</h2><p>Fill in customer and product details below.</p></div></div>
    <div class="page-card">

    <el-form :model="form" label-position="top" ref="formRef">
      <el-row :gutter="16">
        <el-col :span="8"><el-form-item label="Customer Name" required><el-input v-model="form.customer_name" placeholder="Customer full name" /></el-form-item></el-col>
        <el-col :span="4"><el-form-item label="Gender" required><el-select v-model="form.customer_gender"><el-option label="Male" value="male" /><el-option label="Female" value="female" /></el-select></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="Phone" required><el-input v-model="form.customer_phone" placeholder="Phone number" maxlength="11" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="Streamer" required><el-select v-model="form.streamer_id" placeholder="Select"><el-option v-for="s in streamers" :key="s.id" :label="s.name" :value="s.id" /></el-select></el-form-item></el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="Address" required><el-input v-model="form.customer_address" type="textarea" :rows="2" placeholder="Delivery address" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="Payment Status" required><el-select v-model="form.payment_status_id" placeholder="Select"><el-option v-for="p in payStatuses" :key="p.id" :label="p.name" :value="p.id" /></el-select></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="Order Date (下单时间)"><el-date-picker v-model="form.order_time" type="date" placeholder="Pick date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
      </el-row>

      <h4 style="margin:12px 0">Products <span style="color:#f56c6c">*</span></h4>
      <el-table :data="items" border size="small">
        <el-table-column label="Product" min-width="170">
          <template #default="{row, $index}">
            <el-select v-model="row.product_id" placeholder="Select product" filterable @change="(val) => onProductChange($index, val)" style="width:100%">
              <el-option v-for="p in availableProducts($index)" :key="p.id" :label="`${p.code} - ${p.name} (₦${Number(p.price).toLocaleString()})`" :value="p.id" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="Price" width="120">
          <template #default="{row}">{{ row.unit_price ? '₦' + Number(row.unit_price).toLocaleString() : '-' }}</template>
        </el-table-column>
        <el-table-column label="Qty" width="140">
          <template #default="{row}"><el-input-number v-model="row.quantity" :min="1" :max="999" size="small" @change="calcTotal" /></template>
        </el-table-column>
        <el-table-column label="Subtotal" width="130">
          <template #default="{row}">{{ row.subtotal ? '₦' + Number(row.subtotal).toLocaleString() : '-' }}</template>
        </el-table-column>
        <el-table-column label="Actions" width="70">
          <template #default="{$index}">
            <el-button link type="danger" :disabled="items.length <= 1" @click="removeItem($index)">Del</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button size="small" style="margin-top:8px" @click="addItem">+ Add Product</el-button>

      <el-row :gutter="16" style="margin-top:16px">
        <el-col :span="8"><el-form-item label="Total Amount"><el-input :model-value="'₦' + fmtNaira(totalAmount)" disabled /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="Actual Amount"><el-input-number v-model="form.actual_amount" :min="0" :step="100" style="width:100%" /></el-form-item></el-col>
      </el-row>

      <!-- Payment Proof Upload -->
      <el-form-item label="Payment Proof" style="margin-top:16px">
        <el-upload
          :action="uploadUrl"
          :headers="uploadHeaders"
          :on-success="onUploadSuccess"
          :on-error="onUploadError"
          :before-upload="beforeUpload"
          :show-file-list="false"
          accept="image/*"
          drag
        >
          <template v-if="form.payment_image">
            <img :src="form.payment_image" style="max-width:200px;max-height:150px;border-radius:6px" />
            <p style="margin-top:8px;font-size:12px;color:#909399">Click to change</p>
          </template>
          <template v-else>
            <el-icon :size="32" color="#909399"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></el-icon>
            <p style="font-size:13px;color:#909399;margin-top:8px">Drop payment screenshot or click to upload</p>
          </template>
        </el-upload>
      </el-form-item>

      <div style="margin-top:16px;display:flex;gap:10px">
        <el-button type="primary" :loading="saving" @click="handleSave">{{ isEdit ? 'Update' : 'Save Order' }}</el-button>
        <el-button @click="$router.back()">Cancel</el-button>
      </div>
    </el-form>
  </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'
import { getToken } from '../utils/auth'

const route = useRoute()
const router = useRouter()
const isEdit = ref(!!route.params.id)
const saving = ref(false)
const streamers = ref([])
const payStatuses = ref([])
const products = ref([])
const items = ref([{ product_id: null, unit_price: 0, quantity: 1, subtotal: 0 }])

const form = ref({
  customer_name: '', customer_gender: '', customer_phone: '', customer_address: '',
  streamer_id: null, payment_status_id: 1, actual_amount: 0,
  order_time: new Date().toISOString().slice(0, 10),
  payment_image: ''
})

const totalAmount = computed(() => items.value.reduce((s, i) => s + (i.subtotal || 0), 0))
function fmtNaira(v) { const n = Number(v); return isNaN(n) ? '0' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// Payment image upload
const uploadUrl = '/lucky_box/api/orders/upload-payment'
const uploadHeaders = computed(() => ({ Authorization: `Bearer ${getToken()}` }))
function beforeUpload(file) {
  if (!file.type.startsWith('image/')) { ElMessage.error('Only images allowed'); return false }
  if (file.size / 1024 / 1024 > 5) { ElMessage.error('Max 5MB'); return false }
  return true
}
function onUploadSuccess(res) { form.value.payment_image = res.url; ElMessage.success('Uploaded') }
function onUploadError() { ElMessage.error('Upload failed') }

// Ctrl+V paste support — listen on document
async function onDocumentPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      if (!blob) continue
      const formData = new FormData()
      formData.append('image', blob, 'paste-' + Date.now() + '.png')
      try {
        const { data } = await api.post('/orders/upload-payment', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        if (data.url) { form.value.payment_image = data.url; ElMessage.success('Pasted!') }
      } catch (err) { ElMessage.error('Paste upload failed') }
      break
    }
  }
}

function availableProducts(idx) {
  const selected = items.value.filter((_, i) => i !== idx).map(i => i.product_id)
  return products.value.filter(p => !selected.includes(p.id))
}

function onProductChange(idx, val) {
  const item = items.value[idx]
  const pid = val !== undefined ? val : item.product_id
  if (pid) {
    const p = products.value.find(p => p.id === pid)
    if (p) { item.unit_price = p.price; item.subtotal = p.price * (item.quantity || 1) }
  } else { item.unit_price = 0; item.subtotal = 0 }
}

function calcTotal() { items.value.forEach((item, i) => onProductChange(i)) }
function addItem() { items.value.push({ product_id: null, unit_price: 0, quantity: 1, subtotal: 0 }) }
function removeItem(idx) { items.value.splice(idx, 1) }

async function handleSave() {
  const f = form.value
  if (!f.customer_name || !f.customer_gender || !f.customer_phone || !f.customer_address || !f.streamer_id || !f.payment_status_id) {
    ElMessage.warning('All fields are required'); return
  }
  if (!/^\d{11}$/.test(f.customer_phone)) { ElMessage.warning('Phone must be 11 digits'); return }
  if (f.payment_status_id !== 3 && !f.payment_image) { ElMessage.warning('Payment proof is required'); return }
  if (items.value.some(i => !i.product_id)) { ElMessage.warning('Select products'); return }
  saving.value = true
  const payload = {
    ...form.value, actual_amount: form.value.actual_amount || totalAmount.value,
    items: items.value.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
  }
  try {
    if (isEdit.value) { await api.put(`/orders/${route.params.id}`, payload) }
    else { await api.post('/orders', payload) }
    ElMessage.success(isEdit.value ? 'Updated' : 'Created')
    router.replace('/lucky_box/orders')
  } catch (err) { ElMessage.error(err.response?.data?.message || 'Failed') }
  finally { saving.value = false }
}

async function loadOrder() {
  const { data } = await api.get(`/orders/${route.params.id}`)
  Object.assign(form.value, {
    customer_name: data.customer_name, customer_gender: data.customer_gender,
    customer_phone: data.customer_phone, customer_address: data.customer_address,
    streamer_id: data.streamer_id, payment_status_id: data.payment_status_id,
    actual_amount: data.actual_amount, payment_image: data.payment_image || ''
  })
  items.value = data.items.map(i => ({ product_id: i.product_id, unit_price: i.unit_price, quantity: i.quantity, subtotal: i.subtotal }))
}

// Auto-sync actual_amount with total for new orders
watch(totalAmount, (v) => { if (!isEdit.value) form.value.actual_amount = v })

// Watch product_id & quantity changes — more reliable than @change event
watch(
  () => items.value.map(i => i.product_id).join(',') + '|' + items.value.map(i => i.quantity).join(','),
  () => calcTotal()
)

onMounted(async () => {
  const [{ data: s }, { data: ps }, { data: pr }] = await Promise.all([
    api.get('/config/streamers'), api.get('/config/payment_statuses'), api.get('/products')
  ])
  streamers.value = s; payStatuses.value = ps; products.value = pr.list || pr
  if (isEdit.value) await loadOrder()
  document.addEventListener('paste', onDocumentPaste)
})
onUnmounted(() => { document.removeEventListener('paste', onDocumentPaste) })
</script>
