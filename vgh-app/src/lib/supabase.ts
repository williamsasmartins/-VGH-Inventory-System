import { createClient } from '@supabase/supabase-js'
import type { MaterialUnit } from '../types/material'

const supabaseUrl = 'https://omszdbiguuqaphwlpfwe.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tc3pkYmlndXVxYXBod2xwZndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMDkyODQsImV4cCI6MjA5MDY4NTI4NH0.JC6eBYAq5UXNKtln25LPkweJE9UyfyuebaU-VTdc-qo'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export interface Material {
  id: string
  code: string
  name: string
  category: string
  unit: MaterialUnit
  current_stock: number
  min_stock_alert: number
  width: number | null
  length: number | null
  thickness: string | null
  created_at: string
}

export interface Transaction {
  id: string
  material_id: string
  type: 'IN' | 'OUT'
  quantity: number
  sheet_size: string | null
  sheet_count: number | null
  notes: string | null
  project_name: string | null
  unit_price: number | null
  store_name: string | null
  created_at: string
  materials?: {
    code: string
    name: string
    category: string
    unit: string
  }
}

export interface MaterialPrice {
  id: number
  material_code: string
  store_name: string
  price: number
}
