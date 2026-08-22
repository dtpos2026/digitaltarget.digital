export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      account_categories: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_categories_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_invoices: {
        Row: {
          created_at: string
          due_at: string | null
          id: string
          issued_at: string
          line_items: Json
          notes: string | null
          number: string
          paid_total: number
          status: string
          subtotal: number
          tax: number
          tenant_id: string | null
          total: number
        }
        Insert: {
          created_at?: string
          due_at?: string | null
          id?: string
          issued_at?: string
          line_items?: Json
          notes?: string | null
          number: string
          paid_total?: number
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
        }
        Update: {
          created_at?: string
          due_at?: string | null
          id?: string
          issued_at?: string
          line_items?: Json
          notes?: string | null
          number?: string
          paid_total?: number
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "admin_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_marketing_contacts: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          email: string | null
          id: string
          linked_device_ids: string[]
          linked_tenant_id: string | null
          name: string | null
          notes: string | null
          owner_name: string | null
          phone: string | null
          restaurant_name: string | null
          source: string | null
          status: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linked_device_ids?: string[]
          linked_tenant_id?: string | null
          name?: string | null
          notes?: string | null
          owner_name?: string | null
          phone?: string | null
          restaurant_name?: string | null
          source?: string | null
          status?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          linked_device_ids?: string[]
          linked_tenant_id?: string | null
          name?: string | null
          notes?: string | null
          owner_name?: string | null
          phone?: string | null
          restaurant_name?: string | null
          source?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_marketing_contacts_linked_tenant_id_fkey"
            columns: ["linked_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_packages: {
        Row: {
          created_at: string
          description: string | null
          devices: number | null
          duration_months: number
          id: string
          is_active: boolean
          monthly_fee: number
          name: string
          setup_fee: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          devices?: number | null
          duration_months?: number
          id?: string
          is_active?: boolean
          monthly_fee?: number
          name: string
          setup_fee?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          devices?: number | null
          duration_months?: number
          id?: string
          is_active?: boolean
          monthly_fee?: number
          name?: string
          setup_fee?: number
          sort_order?: number
        }
        Relationships: []
      }
      admin_payments: {
        Row: {
          amount: number
          id: string
          invoice_id: string | null
          method: string | null
          notes: string | null
          received_at: string
          reference: string | null
          tenant_id: string | null
        }
        Insert: {
          amount: number
          id?: string
          invoice_id?: string | null
          method?: string | null
          notes?: string | null
          received_at?: string
          reference?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number
          id?: string
          invoice_id?: string | null
          method?: string | null
          notes?: string | null
          received_at?: string
          reference?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "admin_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_plans: {
        Row: {
          branch_limit: number | null
          code: string
          created_at: string
          device_limit: number | null
          features: Json
          id: string
          is_active: boolean
          name: string
          price: number
          sort_order: number
        }
        Insert: {
          branch_limit?: number | null
          code: string
          created_at?: string
          device_limit?: number | null
          features?: Json
          id?: string
          is_active?: boolean
          name: string
          price?: number
          sort_order?: number
        }
        Update: {
          branch_limit?: number | null
          code?: string
          created_at?: string
          device_limit?: number | null
          features?: Json
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          sort_order?: number
        }
        Relationships: []
      }
      admin_releases: {
        Row: {
          channel: string
          created_at: string
          download_url: string | null
          id: string
          is_published: boolean
          notes: string | null
          published_at: string | null
          target_tenant_ids: string[]
          version: string
        }
        Insert: {
          channel?: string
          created_at?: string
          download_url?: string | null
          id?: string
          is_published?: boolean
          notes?: string | null
          published_at?: string | null
          target_tenant_ids?: string[]
          version: string
        }
        Update: {
          channel?: string
          created_at?: string
          download_url?: string | null
          id?: string
          is_published?: boolean
          notes?: string | null
          published_at?: string | null
          target_tenant_ids?: string[]
          version?: string
        }
        Relationships: []
      }
      admin_service_calls: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          id: string
          priority: string | null
          resolved_at: string | null
          scheduled_at: string | null
          status: string
          tenant_id: string | null
          title: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          resolved_at?: string | null
          scheduled_at?: string | null
          status?: string
          tenant_id?: string | null
          title?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          resolved_at?: string | null
          scheduled_at?: string | null
          status?: string
          tenant_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_service_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_support_messages: {
        Row: {
          ai_generated: boolean
          attachment_path: string | null
          author_email: string | null
          body: string
          category: string | null
          created_at: string
          direction: string
          id: string
          intent: string | null
          is_internal: boolean
          meta: Json
          read_by_admin: boolean
          read_by_owner: boolean
          status: string | null
          tenant_id: string
        }
        Insert: {
          ai_generated?: boolean
          attachment_path?: string | null
          author_email?: string | null
          body: string
          category?: string | null
          created_at?: string
          direction: string
          id?: string
          intent?: string | null
          is_internal?: boolean
          meta?: Json
          read_by_admin?: boolean
          read_by_owner?: boolean
          status?: string | null
          tenant_id: string
        }
        Update: {
          ai_generated?: boolean
          attachment_path?: string | null
          author_email?: string | null
          body?: string
          category?: string | null
          created_at?: string
          direction?: string
          id?: string
          intent?: string | null
          is_internal?: boolean
          meta?: Json
          read_by_admin?: boolean
          read_by_owner?: boolean
          status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_support_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      advances: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advances_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          branch_code: string | null
          city: string | null
          created_at: string
          email: string | null
          id: string
          invoice_footer: string | null
          invoice_prefix: string | null
          is_active: boolean
          lat: number | null
          lng: number | null
          name: string
          phone: string | null
          registration_number: string | null
          service_radius_km: number | null
          sort_order: number
          tax_number: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          branch_code?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string | null
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          phone?: string | null
          registration_number?: string | null
          service_radius_km?: number | null
          sort_order?: number
          tax_number?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          branch_code?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string | null
          is_active?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          phone?: string | null
          registration_number?: string | null
          service_radius_km?: number | null
          sort_order?: number
          tax_number?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string | null
          direction: string
          id: string
          reason: string | null
          shift_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          created_by?: string | null
          direction: string
          id: string
          reason?: string | null
          shift_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          id?: string
          reason?: string | null
          shift_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          deleted_at: string | null
          icon: string | null
          id: string
          image_path: string | null
          is_active: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_payments: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          credit_balance: number
          id: string
          is_blocked: boolean
          last_order_at: string | null
          lat: number | null
          lng: number | null
          loyalty_points: number
          name: string | null
          phone: string | null
          pin_hash: string | null
          tenant_id: string
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          is_blocked?: boolean
          last_order_at?: string | null
          lat?: number | null
          lng?: number | null
          loyalty_points?: number
          name?: string | null
          phone?: string | null
          pin_hash?: string | null
          tenant_id: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          is_blocked?: boolean
          last_order_at?: string | null
          lat?: number | null
          lng?: number | null
          loyalty_points?: number
          name?: string | null
          phone?: string | null
          pin_hash?: string | null
          tenant_id?: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      day_closes: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "day_closes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "day_closes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          id: string
          image_path: string | null
          is_active: boolean
          items: Json
          name: string
          price: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          image_path?: string | null
          is_active?: boolean
          items?: Json
          name: string
          price: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          image_path?: string | null
          is_active?: boolean
          items?: Json
          name?: string
          price?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          accuracy_m: number | null
          app_version: string | null
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          blocked: boolean
          blocked_at: string | null
          blocked_reason: string | null
          branch_id: string | null
          created_at: string
          device_label: string
          hardware_id: string
          id: string
          ip: string | null
          is_kds: boolean
          kds_kitchen_id: string | null
          kds_kitchen_name: string | null
          last_login_at: string | null
          last_seen_at: string | null
          last_sync_at: string | null
          lat: number | null
          lng: number | null
          login_count: number
          meta: Json
          platform: string | null
          tenant_id: string
        }
        Insert: {
          accuracy_m?: number | null
          app_version?: string | null
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          blocked?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          branch_id?: string | null
          created_at?: string
          device_label: string
          hardware_id: string
          id?: string
          ip?: string | null
          is_kds?: boolean
          kds_kitchen_id?: string | null
          kds_kitchen_name?: string | null
          last_login_at?: string | null
          last_seen_at?: string | null
          last_sync_at?: string | null
          lat?: number | null
          lng?: number | null
          login_count?: number
          meta?: Json
          platform?: string | null
          tenant_id: string
        }
        Update: {
          accuracy_m?: number | null
          app_version?: string | null
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          blocked?: boolean
          blocked_at?: string | null
          blocked_reason?: string | null
          branch_id?: string | null
          created_at?: string
          device_label?: string
          hardware_id?: string
          id?: string
          ip?: string | null
          is_kds?: boolean
          kds_kitchen_id?: string | null
          kds_kitchen_name?: string | null
          last_login_at?: string | null
          last_seen_at?: string | null
          last_sync_at?: string | null
          lat?: number | null
          lng?: number | null
          login_count?: number
          meta?: Json
          platform?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dining_tables: {
        Row: {
          branch_id: string | null
          current_order_id: string | null
          floor_id: string | null
          id: string
          name: string
          pos_x: number | null
          pos_y: number | null
          seated_at: string | null
          seated_guests: number | null
          seats: number
          shape: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          current_order_id?: string | null
          floor_id?: string | null
          id?: string
          name: string
          pos_x?: number | null
          pos_y?: number | null
          seated_at?: string | null
          seated_guests?: number | null
          seats?: number
          shape?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          current_order_id?: string | null
          floor_id?: string | null
          id?: string
          name?: string
          pos_x?: number | null
          pos_y?: number | null
          seated_at?: string | null
          seated_guests?: number | null
          seats?: number
          shape?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dining_tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dining_tables_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dining_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          branch_id: string | null
          id: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "floors_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "floors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_categories: {
        Row: {
          id: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          avg_cost_price: number | null
          base_unit: string
          branch_id: string | null
          category_id: string | null
          conversions: Json
          cost_price: number
          id: string
          image_path: string | null
          is_active: boolean
          low_stock_threshold: number
          name: string
          quantity: number
          sale_price: number
          sku: string | null
          tenant_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          avg_cost_price?: number | null
          base_unit?: string
          branch_id?: string | null
          category_id?: string | null
          conversions?: Json
          cost_price?: number
          id?: string
          image_path?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          quantity?: number
          sale_price?: number
          sku?: string | null
          tenant_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          avg_cost_price?: number | null
          base_unit?: string
          branch_id?: string | null
          category_id?: string | null
          conversions?: Json
          cost_price?: number
          id?: string
          image_path?: string | null
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          quantity?: number
          sale_price?: number
          sku?: string | null
          tenant_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "inventory_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchens: {
        Row: {
          branch_id: string | null
          id: string
          is_active: boolean
          name: string
          printer_role: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          printer_role?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          printer_role?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchens_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leaves: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leaves_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leaves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_branches: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_available: boolean
          menu_item_id: string
          price: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_available?: boolean
          menu_item_id: string
          price?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_available?: boolean
          menu_item_id?: string
          price?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_branches_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          barcode: string | null
          category_id: string | null
          created_at: string
          deleted_at: string | null
          flavor_group: string | null
          flavors: string[]
          id: string
          image_path: string | null
          inch_variants: Json
          inventory_item_id: string | null
          is_active: boolean
          is_token_item: boolean
          kitchen_id: string | null
          name: string
          price: number
          pricing_type: string
          rate_per_kg: number
          size_variants: Json
          sku: string | null
          sort_order: number
          stock_per_unit: number | null
          sub_category: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          flavor_group?: string | null
          flavors?: string[]
          id?: string
          image_path?: string | null
          inch_variants?: Json
          inventory_item_id?: string | null
          is_active?: boolean
          is_token_item?: boolean
          kitchen_id?: string | null
          name: string
          price?: number
          pricing_type?: string
          rate_per_kg?: number
          size_variants?: Json
          sku?: string | null
          sort_order?: number
          stock_per_unit?: number | null
          sub_category?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          created_at?: string
          deleted_at?: string | null
          flavor_group?: string | null
          flavors?: string[]
          id?: string
          image_path?: string | null
          inch_variants?: Json
          inventory_item_id?: string | null
          is_active?: boolean
          is_token_item?: boolean
          kitchen_id?: string | null
          name?: string
          price?: number
          pricing_type?: string
          rate_per_kg?: number
          size_variants?: Json
          sku?: string | null
          sort_order?: number
          stock_per_unit?: number | null
          sub_category?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      module_documents: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          doc_id: string
          id: string
          kind: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          doc_id: string
          id?: string
          kind: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          doc_id?: string
          id?: string
          kind?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_documents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_counters: {
        Row: {
          branch_id: string
          last_number: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          last_number?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          last_number?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_counters_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          branch_id: string | null
          client_seq: number
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          order_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id: string
          order_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          order_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          branch_id: string | null
          client_seq: number
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          order_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id: string
          order_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          order_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          branch_id: string | null
          client_seq: number
          created_at: string
          data: Json
          deleted_at: string | null
          device_id: string | null
          id: string
          order_number: number | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          device_id?: string | null
          id: string
          order_number?: number | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          client_seq?: number
          created_at?: string
          data?: Json
          deleted_at?: string | null
          device_id?: string | null
          id?: string
          order_number?: number | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parties_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parties_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_accounts: {
        Row: {
          account_number: string | null
          branch_id: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          tenant_id: string
          type: string
        }
        Insert: {
          account_number?: string | null
          branch_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          type: string
        }
        Update: {
          account_number?: string | null
          branch_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_accounts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payslips_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_owners: {
        Row: {
          claimed_at: string | null
          created_at: string
          email: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          created_at?: string
          email: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_owners_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          discount_type: string
          discount_value: number
          id: string
          is_active: boolean
          max_uses: number | null
          tenant_id: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          discount_type: string
          discount_value: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          tenant_id: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          discount_type?: string
          discount_value?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          tenant_id?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_entries: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receiving_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_calls: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          branch_id: string | null
          created_at: string
          floor_name: string | null
          id: string
          message: string
          table_label: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          branch_id?: string | null
          created_at?: string
          floor_name?: string | null
          id?: string
          message?: string
          table_label: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          branch_id?: string | null
          created_at?: string
          floor_name?: string | null
          id?: string
          message?: string
          table_label?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_calls_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          closed_by_name: string | null
          device_id: string | null
          ending_cash: number | null
          expected_cash: number | null
          id: string
          opened_at: string
          opened_by: string | null
          opened_by_name: string | null
          starting_cash: number
          status: string
          tenant_id: string
          variance: number | null
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          device_id?: string | null
          ending_cash?: number | null
          expected_cash?: number | null
          id: string
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string | null
          starting_cash?: number
          status?: string
          tenant_id: string
          variance?: number | null
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closed_by_name?: string | null
          device_id?: string | null
          ending_cash?: number | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opened_by_name?: string | null
          starting_cash?: number
          status?: string
          tenant_id?: string
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_audit_logs: {
        Row: {
          action: string
          amount: number | null
          approved_by: string | null
          branch_id: string | null
          created_at: string
          device_id: string | null
          device_name: string | null
          id: string
          meta: Json
          order_id: string | null
          order_number: number | null
          reason: string | null
          table_label: string | null
          tenant_id: string
          user_id: string | null
          user_name: string | null
          user_role: string | null
        }
        Insert: {
          action: string
          amount?: number | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          device_id?: string | null
          device_name?: string | null
          id?: string
          meta?: Json
          order_id?: string | null
          order_number?: number | null
          reason?: string | null
          table_label?: string | null
          tenant_id: string
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Update: {
          action?: string
          amount?: number | null
          approved_by?: string | null
          branch_id?: string | null
          created_at?: string
          device_id?: string | null
          device_name?: string | null
          id?: string
          meta?: Json
          order_id?: string | null
          order_number?: number | null
          reason?: string | null
          table_label?: string | null
          tenant_id?: string
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_locations: {
        Row: {
          accuracy_m: number | null
          branch_id: string | null
          consent: boolean
          created_at: string
          device_name: string | null
          id: string
          lat: number
          lng: number
          recorded_at: string
          speed_kmh: number | null
          staff_key: string
          tenant_id: string
          user_id: string | null
          user_name: string | null
          user_role: string | null
        }
        Insert: {
          accuracy_m?: number | null
          branch_id?: string | null
          consent?: boolean
          created_at?: string
          device_name?: string | null
          id?: string
          lat: number
          lng: number
          recorded_at?: string
          speed_kmh?: number | null
          staff_key: string
          tenant_id: string
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Update: {
          accuracy_m?: number | null
          branch_id?: string | null
          consent?: boolean
          created_at?: string
          device_name?: string | null
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          speed_kmh?: number | null
          staff_key?: string
          tenant_id?: string
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_locations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_logs: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          can_manage_team: boolean
          created_at: string
          email: string
          is_active: boolean
          user_id: string
        }
        Insert: {
          can_manage_team?: boolean
          created_at?: string
          email: string
          is_active?: boolean
          user_id: string
        }
        Update: {
          can_manage_team?: boolean
          created_at?: string
          email?: string
          is_active?: boolean
          user_id?: string
        }
        Relationships: []
      }
      sync_ops: {
        Row: {
          applied_at: string
          device_id: string | null
          entity: string
          entity_id: string | null
          op_id: string
          order_number: number | null
          tenant_id: string | null
        }
        Insert: {
          applied_at?: string
          device_id?: string | null
          entity: string
          entity_id?: string | null
          op_id: string
          order_number?: number | null
          tenant_id?: string | null
        }
        Update: {
          applied_at?: string
          device_id?: string | null
          entity?: string
          entity_id?: string | null
          op_id?: string
          order_number?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_ops_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          branch_id: string | null
          duration_minutes: number
          freed_at: string
          guests: number | null
          id: string
          order_id: string | null
          order_number: number | null
          seated_at: string
          table_id: string
          tenant_id: string
          total: number | null
        }
        Insert: {
          branch_id?: string | null
          duration_minutes: number
          freed_at: string
          guests?: number | null
          id?: string
          order_id?: string | null
          order_number?: number | null
          seated_at: string
          table_id: string
          tenant_id: string
          total?: number | null
        }
        Update: {
          branch_id?: string | null
          duration_minutes?: number
          freed_at?: string
          guests?: number | null
          id?: string
          order_id?: string | null
          order_number?: number | null
          seated_at?: string
          table_id?: string
          tenant_id?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "dining_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          settings: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string
          created_at?: string
          id?: string
          settings?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          settings?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          custom_device_limit: number | null
          id: string
          is_active: boolean
          name: string
          owner_user_id: string | null
          plan: string
          plan_expires_at: string | null
          slug: string
          updated_at: string
          workspace_code: string | null
        }
        Insert: {
          created_at?: string
          custom_device_limit?: number | null
          id?: string
          is_active?: boolean
          name: string
          owner_user_id?: string | null
          plan?: string
          plan_expires_at?: string | null
          slug: string
          updated_at?: string
          workspace_code?: string | null
        }
        Update: {
          created_at?: string
          custom_device_limit?: number | null
          id?: string
          is_active?: boolean
          name?: string
          owner_user_id?: string | null
          plan?: string
          plan_expires_at?: string | null
          slug?: string
          updated_at?: string
          workspace_code?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branch_access: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          is_active: boolean
          role: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          role?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          role?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branch_access_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_branch_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          all_branches: boolean
          branch_id: string | null
          created_at: string
          display_name: string
          feature_permissions: string[]
          is_active: boolean
          permissions: string[]
          phone: string | null
          pin_hash: string | null
          role: string
          tenant_id: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          all_branches?: boolean
          branch_id?: string | null
          created_at?: string
          display_name: string
          feature_permissions?: string[]
          is_active?: boolean
          permissions?: string[]
          phone?: string | null
          pin_hash?: string | null
          role: string
          tenant_id: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          all_branches?: boolean
          branch_id?: string | null
          created_at?: string
          display_name?: string
          feature_permissions?: string[]
          is_active?: boolean
          permissions?: string[]
          phone?: string | null
          pin_hash?: string | null
          role?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wastages: {
        Row: {
          branch_id: string | null
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wastages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wastages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_sync_batch: {
        Args: { p_device_id: string; p_ops: Json }
        Returns: {
          entity_id: string
          op_id: string
          order_number: number
          reason: string
          result: string
        }[]
      }
      auth_branch_ids: {
        Args: never
        Returns: {
          branch_id: string
        }[]
      }
      auth_can_branch: { Args: { p_branch: string }; Returns: boolean }
      auth_is_tenant_admin: { Args: never; Returns: boolean }
      auth_tenant_id: { Args: never; Returns: string }
      device_heartbeat: {
        Args: {
          p_app_version?: string
          p_device_id: string
          p_lat?: number
          p_lng?: number
        }
        Returns: undefined
      }
      gen_workspace_code: { Args: never; Returns: string }
      get_workspace_code: { Args: { _tenant_id: string }; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
      next_order_number: {
        Args: { p_branch: string; p_tenant: string }
        Returns: number
      }
      pos_list_users: {
        Args: never
        Returns: {
          all_branches: boolean
          branch_id: string
          display_name: string
          feature_permissions: string[]
          is_active: boolean
          permissions: string[]
          phone: string
          role: string
          user_id: string
          username: string
        }[]
      }
      pos_set_staff_profile: {
        Args: {
          p_all_branches?: boolean
          p_branch_id?: string
          p_display_name: string
          p_feature_permissions?: string[]
          p_is_active?: boolean
          p_password: string
          p_permissions?: string[]
          p_phone?: string
          p_role: string
          p_tenant: string
          p_user_id: string
          p_username: string
        }
        Returns: undefined
      }
      public_call_waiter: {
        Args: {
          p_branch: string
          p_floor_name?: string
          p_message?: string
          p_table_label: string
          p_tenant: string
        }
        Returns: Json
      }
      public_place_order: {
        Args: { p_branch: string; p_order: Json; p_tenant: string }
        Returns: Json
      }
      public_track_order: {
        Args: {
          p_order_id?: string
          p_order_number?: number
          p_phone_last4?: string
          p_table_label?: string
          p_tenant: string
        }
        Returns: Json
      }
      pull_orders_delta: {
        Args: { p_branch: string; p_limit?: number; p_since: string }
        Returns: Json[]
      }
      register_device: {
        Args: {
          p_app_version?: string
          p_branch_id: string
          p_hardware_id: string
          p_ip?: string
          p_label: string
          p_meta?: Json
          p_platform?: string
        }
        Returns: Json
      }
      reset_order_counter: {
        Args: { p_branch?: string; p_start?: number }
        Returns: number
      }
      sa_add_team_member: {
        Args: { p_can_manage?: boolean; p_email: string }
        Returns: undefined
      }
      sa_create_restaurant: {
        Args: { p_email: string; p_name: string; p_plan?: string }
        Returns: Json
      }
      sa_list_team: {
        Args: never
        Returns: {
          can_manage_team: boolean
          created_at: string
          email: string
          is_active: boolean
          user_id: string
        }[]
      }
      sa_remove_team_member: { Args: { p_email: string }; Returns: undefined }
      sa_set_plan: {
        Args: { p_expires?: string; p_plan: string; p_tenant: string }
        Returns: undefined
      }
      set_default_owner_pos_login: {
        Args: { p_tenant: string; p_user_id: string }
        Returns: undefined
      }
      staff_login_check: {
        Args: { p_pin: string; p_tenant: string; p_username: string }
        Returns: Json
      }
      staff_login_global: {
        Args: { p_pin: string; p_username: string; p_workspace_code?: string }
        Returns: Json
      }
      support_mark_read: {
        Args: { p_side: string; p_tenant: string }
        Returns: undefined
      }
      support_unread_counts: {
        Args: never
        Returns: {
          tenant_id: string
          unread: number
        }[]
      }
      update_own_tenant_name: { Args: { p_name: string }; Returns: undefined }
      verify_staff_pin: {
        Args: { p_pin: string; p_tenant: string; p_username: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
