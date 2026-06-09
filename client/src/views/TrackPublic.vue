<template>
  <div class="track-wrap">
    <!-- Header -->
    <div class="track-header">
      <img src="/logo.png" alt="LUCKYBOX" class="track-logo" />
      <p class="track-sub">Track your order</p>
    </div>

    <!-- Search bar -->
    <div class="search-box">
      <input
        v-model="query"
        type="text"
        placeholder="Order No. or last 4 digits of phone"
        @keyup.enter="search"
        class="search-input"
      />
      <button class="search-btn" :disabled="loading" @click="search">Search</button>
    </div>

    <!-- Error -->
    <div v-if="error" class="track-error">{{ error }}</div>

    <!-- Loading -->
    <div v-if="loading" class="track-loading">Searching...</div>

    <!-- Results -->
    <div v-if="results.length > 0 && !loading" class="results-wrap">
      <p class="results-summary">{{ results.length }} order(s) found</p>

      <div v-for="(order, idx) in results" :key="idx" class="order-card">
        <div class="order-top">
          <div>
            <span class="order-no">{{ order.order_no }}</span>
            <span :class="['status-tag', statusClass(order.shipping_status)]">{{ statusLabel(order.shipping_status) }}</span>
          </div>
          <span class="order-total">{{ '₦' + Number(order.total_amount).toLocaleString() }}</span>
        </div>

        <div class="order-info">
          <div><span class="lbl">Customer</span> {{ order.customer_name }}</div>
          <div><span class="lbl">Phone</span> {{ order.masked_phone }}</div>
          <div v-if="order.delivery_method">
            <span class="lbl">Method</span> {{ order.delivery_method.toUpperCase() }}
            <template v-if="order.gig_tracking">
              · {{ order.gig_tracking }}
            </template>
          </div>
          <div v-if="order.destination">
            <span class="lbl">Destination</span> {{ order.destination }}
          </div>
        </div>

        <!-- GIGL Timeline -->
        <div v-if="order.events && order.events.length > 0" class="timeline">
          <div v-for="(evt, ei) in order.events" :key="ei" class="tl-row">
            <div class="tl-dot" :class="{ 'tl-done': ei === order.events.length - 1 }"></div>
            <div class="tl-content">
              <div class="tl-desc">{{ evt.status_description }}</div>
              <div class="tl-meta">{{ formatDate(evt.event_time) }} · {{ evt.location }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="track-footer">
      <p>© LUCKYBOX · Track your order anytime</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import api from '../api'

const query = ref('')
const loading = ref(false)
const error = ref('')
const results = ref([])

async function search() {
  const q = query.value.trim()
  if (q.length < 3) { error.value = 'Enter at least 3 characters'; return }
  loading.value = true; error.value = ''; results.value = []
  try {
    const { data } = await api.get('/public/track', { params: { q } })
    results.value = data.results
    if (data.results.length === 0) error.value = 'No orders found'
  } catch (err) { error.value = err.response?.data?.message || 'Search failed' }
  finally { loading.value = false }
}

function statusClass(s) {
  return { pending:'tag-warning', in_transit:'tag-info', delivered:'tag-success', returned:'tag-danger', cancelled:'tag-danger' }[s] || 'tag-warning'
}
function statusLabel(s) {
  return { pending:'Pending', in_transit:'In Transit', delivered:'Delivered', returned:'Returned', cancelled:'Cancelled' }[s] || s || 'Processing'
}
function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}
</script>

<style scoped>
* { box-sizing: border-box; }
.track-wrap {
  max-width: 500px; margin: 0 auto; padding: 24px 16px 40px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: #fafafa; min-height: 100vh;
}

/* Header */
.track-header { text-align: center; margin-bottom: 24px; }
.track-logo { height: 36px; }
.track-sub { font-size: 13px; color: #6b7280; margin-top: 6px; }

/* Search */
.search-box { display: flex; gap: 8px; margin-bottom: 16px; }
.search-input {
  flex: 1; height: 44px; padding: 0 14px; font-size: 14px;
  border: 1px solid #d1d5db; border-radius: 8px; outline: none; background: #fff;
  font-family: inherit;
}
.search-input:focus { border-color: #9ca3af; box-shadow: 0 0 0 3px rgba(0,0,0,0.04); }
.search-btn {
  padding: 0 20px; height: 44px; font-size: 14px; font-weight: 600;
  background: #1a1a1a; color: #fff; border: none; border-radius: 8px; cursor: pointer;
  font-family: inherit;
}
.search-btn:hover { background: #333; }
.search-btn:disabled { opacity: 0.6; }

/* States */
.track-error { text-align: center; color: #dc2626; font-size: 13px; margin-bottom: 12px; }
.track-loading { text-align: center; color: #6b7280; font-size: 13px; padding: 24px 0; }

/* Results */
.results-summary { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
.order-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 16px; margin-bottom: 12px;
}
.order-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.order-no { font-family: monospace; font-size: 13px; font-weight: 600; }
.order-total { font-size: 15px; font-weight: 700; }

/* Status tags */
.status-tag {
  display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px;
  font-weight: 600; text-transform: uppercase; margin-left: 8px;
}
.tag-warning { background: #fef3c7; color: #92400e; }
.tag-info { background: #e0f2fe; color: #0369a1; }
.tag-success { background: #dcfce7; color: #166534; }
.tag-danger { background: #fee2e2; color: #991b1b; }

/* Info rows */
.order-info { font-size: 13px; color: #374151; line-height: 1.8; margin-bottom: 8px; }
.order-info .lbl { color: #9ca3af; font-size: 11px; margin-right: 4px; }

/* Timeline */
.timeline { padding-left: 2px; }
.tl-row { display: flex; gap: 10px; padding: 4px 0; }
.tl-dot {
  width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0;
  background: #d1d5db;
}
.tl-done { background: #22c55e; }
.tl-desc { font-size: 12px; color: #374151; }
.tl-meta { font-size: 10px; color: #9ca3af; margin-top: 1px; }

/* Footer */
.track-footer { text-align: center; margin-top: 32px; }
.track-footer p { font-size: 11px; color: #9ca3af; }
</style>
