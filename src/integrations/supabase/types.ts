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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          address: string | null
          business_name: string
          business_tagline: string
          contact_person: string | null
          created_at: string
          currency_symbol: string
          date_format: string
          email: string | null
          id: string
          invoice_footer: string
          logo_url: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_name?: string
          business_tagline?: string
          contact_person?: string | null
          created_at?: string
          currency_symbol?: string
          date_format?: string
          email?: string | null
          id?: string
          invoice_footer?: string
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_name?: string
          business_tagline?: string
          contact_person?: string | null
          created_at?: string
          currency_symbol?: string
          date_format?: string
          email?: string | null
          id?: string
          invoice_footer?: string
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string
          created_at: string
          default_unit: string
          description: string | null
          icon: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          default_unit?: string
          description?: string | null
          icon?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          default_unit?: string
          description?: string | null
          icon?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          monthly_salary: number
          name: string
          phone: string | null
          position: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_salary?: number
          name: string
          phone?: string | null
          position?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_salary?: number
          name?: string
          phone?: string | null
          position?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          accounting_class: string
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          accounting_class?: string
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          accounting_class?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string | null
          expense_date: string
          id: string
          salary_month: string | null
          type: string
          updated_at: string
          vault_user_id: string | null
        }
        Insert: {
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string | null
          expense_date?: string
          id?: string
          salary_month?: string | null
          type?: string
          updated_at?: string
          vault_user_id?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string | null
          expense_date?: string
          id?: string
          salary_month?: string | null
          type?: string
          updated_at?: string
          vault_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vault_user_id_fkey"
            columns: ["vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          method: string
          note: string | null
          payment_date: string
          restaurant_id: string | null
          sale_id: string | null
          updated_at: string
          vault_user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          payment_date?: string
          restaurant_id?: string | null
          sale_id?: string | null
          updated_at?: string
          vault_user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          payment_date?: string
          restaurant_id?: string | null
          sale_id?: string | null
          updated_at?: string
          vault_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_vault_user_id_fkey"
            columns: ["vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          avg_cost: number
          category_id: string | null
          created_at: string
          current_stock: number
          default_purchase_price: number
          default_selling_price: number
          id: string
          max_stock_level: number
          name: string
          reorder_level: number
          sku: string
          unit: string
          updated_at: string
        }
        Insert: {
          avg_cost?: number
          category_id?: string | null
          created_at?: string
          current_stock?: number
          default_purchase_price?: number
          default_selling_price?: number
          id?: string
          max_stock_level?: number
          name: string
          reorder_level?: number
          sku?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          avg_cost?: number
          category_id?: string | null
          created_at?: string
          current_stock?: number
          default_purchase_price?: number
          default_selling_price?: number
          id?: string
          max_stock_level?: number
          name?: string
          reorder_level?: number
          sku?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          created_at: string
          id: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total: number
          product_id: string
          purchase_id: string
          quantity: number
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total?: number
          product_id?: string
          purchase_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_paid: number
          created_at: string
          created_by: string | null
          grand_total: number
          id: string
          notes: string | null
          payment_status: string
          purchase_date: string
          reference_no: string
          supplier_id: string | null
          vault_user_id: string | null
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          payment_status?: string
          purchase_date?: string
          reference_no?: string
          supplier_id?: string | null
          vault_user_id?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          grand_total?: number
          id?: string
          notes?: string | null
          payment_status?: string
          purchase_date?: string
          reference_no?: string
          supplier_id?: string | null
          vault_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_vault_user_id_fkey"
            columns: ["vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          credit_terms: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          credit_terms?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          credit_terms?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          cost_price: number
          created_at: string
          id: string
          line_total: number
          product_id: string
          quantity: number
          sale_id: string
          unit_price: number
        }
        Insert: {
          cost_price?: number
          created_at?: string
          id?: string
          line_total: number
          product_id: string
          quantity: number
          sale_id: string
          unit_price: number
        }
        Update: {
          cost_price?: number
          created_at?: string
          id?: string
          line_total?: number
          product_id?: string
          quantity?: number
          sale_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          amount_received: number
          created_at: string
          created_by: string | null
          customer_name: string | null
          discount: number
          grand_total: number
          id: string
          invoice_no: string
          notes: string | null
          payment_method: string | null
          payment_status: string
          restaurant_id: string | null
          sale_date: string
          source: string
          subtotal: number
          tax: number
          total_cost: number
        }
        Insert: {
          amount_received?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          discount?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          restaurant_id?: string | null
          sale_date?: string
          source?: string
          subtotal?: number
          tax?: number
          total_cost?: number
        }
        Update: {
          amount_received?: number
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          discount?: number
          grand_total?: number
          id?: string
          invoice_no?: string
          notes?: string | null
          payment_method?: string | null
          payment_status?: string
          restaurant_id?: string | null
          sale_date?: string
          source?: string
          subtotal?: number
          tax?: number
          total_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          balance_after: number
          created_at: string
          id: string
          movement_type: string
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          balance_after: number
          created_at?: string
          id?: string
          movement_type: string
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          balance_after?: number
          created_at?: string
          id?: string
          movement_type?: string
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_vault_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string | null
          id: string
          new_vault_user_id: string
          old_vault_user_id: string
          purchase_id: string | null
          reason: string
          supplier_payment_id: string
        }
        Insert: {
          corrected_at?: string
          corrected_by?: string | null
          id?: string
          new_vault_user_id: string
          old_vault_user_id: string
          purchase_id?: string | null
          reason: string
          supplier_payment_id: string
        }
        Update: {
          corrected_at?: string
          corrected_by?: string | null
          id?: string
          new_vault_user_id?: string
          old_vault_user_id?: string
          purchase_id?: string | null
          reason?: string
          supplier_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_vault_corrections_new_vault_user_id_fkey"
            columns: ["new_vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_vault_corrections_old_vault_user_id_fkey"
            columns: ["old_vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_vault_corrections_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_vault_corrections_supplier_payment_id_fkey"
            columns: ["supplier_payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          method: string
          note: string | null
          payment_date: string
          purchase_id: string | null
          supplier_id: string
          updated_at: string
          vault_user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          payment_date?: string
          purchase_id?: string | null
          supplier_id: string
          updated_at?: string
          vault_user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: string
          note?: string | null
          payment_date?: string
          purchase_id?: string | null
          supplier_id?: string
          updated_at?: string
          vault_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_vault_user_id_fkey"
            columns: ["vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          destination_vault_user_id: string
          id: string
          movement_date: string
          movement_type: string
          note: string | null
          source_vault_user_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          destination_vault_user_id: string
          id?: string
          movement_date?: string
          movement_type: string
          note?: string | null
          source_vault_user_id: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          destination_vault_user_id?: string
          id?: string
          movement_date?: string
          movement_type?: string
          note?: string | null
          source_vault_user_id?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_cash_movements_destination_vault_user_id_fkey"
            columns: ["destination_vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_cash_movements_source_vault_user_id_fkey"
            columns: ["source_vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_topups: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          topup_date: string
          updated_at: string
          vault_user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          topup_date?: string
          updated_at?: string
          vault_user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          topup_date?: string
          updated_at?: string
          vault_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_topups_vault_user_id_fkey"
            columns: ["vault_user_id"]
            isOneToOne: false
            referencedRelation: "vault_users"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_users: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          phone: string | null
          updated_at: string
          vault_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          updated_at?: string
          vault_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          phone?: string | null
          updated_at?: string
          vault_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      correct_supplier_payment_vault: {
        Args: {
          p_new_vault_user_id: string
          p_reason: string
          p_supplier_payment_id: string
        }
        Returns: string
      }
      create_pos_sale: {
        Args: {
          p_customer_name: string
          p_discount: number
          p_items: Json
          p_method: string
          p_note: string
          p_vault_user_id: string
        }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_business_cash_vaults: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      record_supplier_payment: {
        Args: {
          p_amount: number
          p_method: string
          p_note?: string
          p_payment_date: string
          p_preferred_purchase_id?: string
          p_supplier_id: string
          p_vault_user_id?: string
        }
        Returns: Json
      }
      record_vault_cash_movement: {
        Args: {
          p_amount: number
          p_destination_vault_user_id: string
          p_movement_date?: string
          p_movement_type: string
          p_note?: string
          p_source_vault_user_id: string
        }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          destination_vault_user_id: string
          id: string
          movement_date: string
          movement_type: string
          note: string | null
          source_vault_user_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vault_cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      vault_available_balance: {
        Args: { p_vault_user_id: string }
        Returns: number
      }
      void_vault_cash_movement: {
        Args: { p_movement_id: string; p_reason: string }
        Returns: {
          amount: number
          created_at: string
          created_by: string | null
          destination_vault_user_id: string
          id: string
          movement_date: string
          movement_type: string
          note: string | null
          source_vault_user_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "vault_cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "staff"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
    },
  },
} as const
