import axios from 'axios'

const allocationHttp = axios.create({
  baseURL:
    import.meta.env.VITE_ALLOCATION_API_BASE_URL ||
    'http://127.0.0.1:5001/api/allocation',
  timeout: 120000,
})

export default allocationHttp
