import axios from 'axios'
import { getToken, logout } from '../utils/auth'

const api = axios.create({ baseURL: '/lucky_box/api', timeout: 15000 })

api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(res => res, err => {
  if (err.response && err.response.status === 401) { logout(); window.location.href = '/lucky_box/login' }
  return Promise.reject(err)
})

export default api
