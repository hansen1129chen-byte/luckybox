import { createRouter, createWebHistory } from 'vue-router'
import { isLoggedIn, getUser } from '../utils/auth'

const B = '/lucky_box'

const routes = [
  { path: B + '/login', name: 'Login', component: () => import('../views/Login.vue'), meta: { guest: true } },
  { path: '/', redirect: B + '/orders' },
  { path: B, redirect: B + '/orders' },
  { path: B + '/orders', name: 'Orders', component: () => import('../views/Orders.vue') },
  { path: B + '/orders/new', name: 'NewOrder', component: () => import('../views/OrderForm.vue') },
  { path: B + '/orders/:id/edit', name: 'EditOrder', component: () => import('../views/OrderForm.vue') },
  { path: B + '/shipping', name: 'Shipping', component: () => import('../views/Shipping.vue') },
  { path: B + '/products', name: 'Products', component: () => import('../views/Products.vue') },
  { path: B + '/config', name: 'Config', component: () => import('../views/Config.vue'), meta: { admin: true } },
  { path: B + '/stats', name: 'Stats', component: () => import('../views/Stats.vue'), meta: { admin: true } },
  { path: B + '/accounts', name: 'Accounts', component: () => import('../views/Accounts.vue'), meta: { admin: true } },
  { path: B + '/profile', name: 'Profile', component: () => import('../views/Profile.vue') },
  { path: '/shipping_check', name: 'ShippingCheck', component: () => import('../views/TrackPublic.vue'), meta: { public: true } },
  { path: '/tracking_check', redirect: '/shipping_check' },
  { path: '/:pathMatch(.*)*', redirect: B + '/orders' },
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach((to, from, next) => {
  if (to.meta.public) return next()
  const loggedIn = isLoggedIn()
  const user = getUser()
  if (to.meta.guest && loggedIn) return next(B + '/orders')
  if (!loggedIn && !to.meta.guest) return next(B + '/login')
  if (to.meta.admin && user?.role !== 'admin') return next(B + '/orders')
  next()
})

export default router
