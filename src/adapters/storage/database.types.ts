export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor: string | null
          after: Json | null
          at: string
          before: Json | null
          call_id: string | null
          client_id: string | null
          entity_id: string | null
          entity_type: string | null
          firm_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          call_id?: string | null
          client_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          firm_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          call_id?: string | null
          client_id?: string | null
          entity_id?: string | null
          entity_type?: string | null
          firm_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "audit_log_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "audit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      call_components: {
        Row: {
          allocation_basis: string
          call_id: string
          category: string | null
          component_id: string
          component_name: string
          excused_lp_ids: string[]
          id: string
          notes: string | null
          position: number
          reduces_unfunded: boolean
          total_amount: number
        }
        Insert: {
          allocation_basis?: string
          call_id: string
          category?: string | null
          component_id: string
          component_name: string
          excused_lp_ids?: string[]
          id?: string
          notes?: string | null
          position?: number
          reduces_unfunded?: boolean
          total_amount?: number
        }
        Update: {
          allocation_basis?: string
          call_id?: string
          category?: string | null
          component_id?: string
          component_name?: string
          excused_lp_ids?: string[]
          id?: string
          notes?: string | null
          position?: number
          reduces_unfunded?: boolean
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_components_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_components_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_expected_output: {
        Row: {
          call_id: string
          figures: Json
          id: string
          lp_id: string
          position: number
        }
        Insert: {
          call_id: string
          figures?: Json
          id?: string
          lp_id: string
          position?: number
        }
        Update: {
          call_id?: string
          figures?: Json
          id?: string
          lp_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_expected_output_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_expected_output_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_fee_offsets: {
        Row: {
          allocation_method: string
          amount: number
          call_id: string
          description: string | null
          id: string
          offset_id: string
          position: number
        }
        Insert: {
          allocation_method?: string
          amount?: number
          call_id: string
          description?: string | null
          id?: string
          offset_id: string
          position?: number
        }
        Update: {
          allocation_method?: string
          amount?: number
          call_id?: string
          description?: string | null
          id?: string
          offset_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_fee_offsets_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_fee_offsets_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_register: {
        Row: {
          call_id: string
          commitment: number
          fee_exempt: boolean
          id: string
          investor_id: string
          mgmt_fee_rate_override: number | null
          opening_invested_capital: number
          opening_paid_in: number
          opening_ucc: number
          position: number
          status: string
        }
        Insert: {
          call_id: string
          commitment?: number
          fee_exempt?: boolean
          id?: string
          investor_id: string
          mgmt_fee_rate_override?: number | null
          opening_invested_capital?: number
          opening_paid_in?: number
          opening_ucc?: number
          position?: number
          status?: string
        }
        Update: {
          call_id?: string
          commitment?: number
          fee_exempt?: boolean
          id?: string
          investor_id?: string
          mgmt_fee_rate_override?: number | null
          opening_invested_capital?: number
          opening_paid_in?: number
          opening_ucc?: number
          position?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_register_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_register_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_register_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      call_results: {
        Row: {
          call_id: string
          checks: Json
          computed_at: string
          computed_by: string | null
          engine_version: string
          golden_diffs: Json
          id: string
          rows: Json
          totals: Json
        }
        Insert: {
          call_id: string
          checks?: Json
          computed_at?: string
          computed_by?: string | null
          engine_version: string
          golden_diffs?: Json
          id?: string
          rows: Json
          totals: Json
        }
        Update: {
          call_id?: string
          checks?: Json
          computed_at?: string
          computed_by?: string | null
          engine_version?: string
          golden_diffs?: Json
          id?: string
          rows?: Json
          totals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "call_results_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_results_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_transfers: {
        Row: {
          call_id: string
          effective_date: string | null
          from_lp_id: string | null
          id: string
          notes: string | null
          position: number
          to_lp_id: string | null
          to_lp_name_if_new: string | null
          transfer_id: string
          transfer_pct: number | null
          transfer_type: string
          transfers_commitment: boolean
          transfers_paid_in: boolean
          transfers_ucc: boolean
        }
        Insert: {
          call_id: string
          effective_date?: string | null
          from_lp_id?: string | null
          id?: string
          notes?: string | null
          position?: number
          to_lp_id?: string | null
          to_lp_name_if_new?: string | null
          transfer_id: string
          transfer_pct?: number | null
          transfer_type?: string
          transfers_commitment?: boolean
          transfers_paid_in?: boolean
          transfers_ucc?: boolean
        }
        Update: {
          call_id?: string
          effective_date?: string | null
          from_lp_id?: string | null
          id?: string
          notes?: string | null
          position?: number
          to_lp_id?: string | null
          to_lp_name_if_new?: string | null
          transfer_id?: string
          transfer_pct?: number | null
          transfer_type?: string
          transfers_commitment?: boolean
          transfers_paid_in?: boolean
          transfers_ucc?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "call_transfers_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_transfers_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          call_date: string | null
          call_no: number
          client_id: string
          created_at: string
          created_by: string | null
          default_mgmt_fee_basis: string | null
          default_mgmt_fee_rate_annual: number | null
          fee_basis: string | null
          fee_default_rate_annual: number | null
          fee_exempt_lp_ids: string[]
          fee_period_fraction: number | null
          fee_reduces_unfunded: boolean
          fund_name: string
          gp_name: string | null
          id: string
          locked_at: string | null
          mgmt_fee_period_fraction: number | null
          org_expense_cap: number | null
          payment_due_date: string | null
          prepared_by: string | null
          reporting_currency: string | null
          rounding_decimals: number | null
          rounding_plug_lp_id: string | null
          signatory_name: string | null
          signatory_title: string | null
          source_components: string
          source_fee: string
          source_file_name: string | null
          source_file_path: string | null
          source_lps: string
          source_setup: string
          source_transfers: string
          updated_at: string
        }
        Insert: {
          call_date?: string | null
          call_no: number
          client_id: string
          created_at?: string
          created_by?: string | null
          default_mgmt_fee_basis?: string | null
          default_mgmt_fee_rate_annual?: number | null
          fee_basis?: string | null
          fee_default_rate_annual?: number | null
          fee_exempt_lp_ids?: string[]
          fee_period_fraction?: number | null
          fee_reduces_unfunded?: boolean
          fund_name: string
          gp_name?: string | null
          id?: string
          locked_at?: string | null
          mgmt_fee_period_fraction?: number | null
          org_expense_cap?: number | null
          payment_due_date?: string | null
          prepared_by?: string | null
          reporting_currency?: string | null
          rounding_decimals?: number | null
          rounding_plug_lp_id?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          source_components?: string
          source_fee?: string
          source_file_name?: string | null
          source_file_path?: string | null
          source_lps?: string
          source_setup?: string
          source_transfers?: string
          updated_at?: string
        }
        Update: {
          call_date?: string | null
          call_no?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          default_mgmt_fee_basis?: string | null
          default_mgmt_fee_rate_annual?: number | null
          fee_basis?: string | null
          fee_default_rate_annual?: number | null
          fee_exempt_lp_ids?: string[]
          fee_period_fraction?: number | null
          fee_reduces_unfunded?: boolean
          fund_name?: string
          gp_name?: string | null
          id?: string
          locked_at?: string | null
          mgmt_fee_period_fraction?: number | null
          org_expense_cap?: number | null
          payment_due_date?: string | null
          prepared_by?: string | null
          reporting_currency?: string | null
          rounding_decimals?: number | null
          rounding_plug_lp_id?: string | null
          signatory_name?: string | null
          signatory_title?: string | null
          source_components?: string
          source_fee?: string
          source_file_name?: string | null
          source_file_path?: string | null
          source_lps?: string
          source_setup?: string
          source_transfers?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          created_at: string
          firm_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          firm_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          firm_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_members: {
        Row: {
          created_at: string
          firm_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          firm_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          firm_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_members_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      investors: {
        Row: {
          client_id: string
          contact_email: string | null
          created_at: string
          id: string
          lp_id: string
          lp_name: string
          lp_type: string
          notes: string | null
          side_letter_ref: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          contact_email?: string | null
          created_at?: string
          id?: string
          lp_id: string
          lp_name: string
          lp_type?: string
          notes?: string | null
          side_letter_ref?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          contact_email?: string | null
          created_at?: string
          id?: string
          lp_id?: string
          lp_name?: string
          lp_type?: string
          notes?: string | null
          side_letter_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "investors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          call_id: string
          created_at: string
          email_attempted_at: string | null
          email_delivered_to: string | null
          email_error: string | null
          email_message_id: string | null
          email_status: string | null
          id: string
          investor_id: string
          payload: Json | null
          result_id: string | null
          sent_at: string | null
          sent_by: string | null
          sent_to_email: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          call_id: string
          created_at?: string
          email_attempted_at?: string | null
          email_delivered_to?: string | null
          email_error?: string | null
          email_message_id?: string | null
          email_status?: string | null
          id?: string
          investor_id: string
          payload?: Json | null
          result_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to_email?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          call_id?: string
          created_at?: string
          email_attempted_at?: string | null
          email_delivered_to?: string | null
          email_error?: string | null
          email_message_id?: string | null
          email_status?: string | null
          id?: string
          investor_id?: string
          payload?: Json | null
          result_id?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_to_email?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "notices_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "call_latest_result"
            referencedColumns: ["result_id"]
          },
          {
            foreignKeyName: "notices_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "call_results"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      call_latest_result: {
        Row: {
          call_id: string | null
          computed_at: string | null
          engine_version: string | null
          result_id: string | null
          totals: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "call_results_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_stages"
            referencedColumns: ["call_id"]
          },
          {
            foreignKeyName: "call_results_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      call_stages: {
        Row: {
          active_investors: number | null
          call_id: string | null
          call_no: number | null
          client_id: string | null
          components: number | null
          locked_at: string | null
          notices_approved: number | null
          notices_draft: number | null
          notices_sent: number | null
          stage: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_positions"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_positions: {
        Row: {
          called_against_commitment: number | null
          called_to_date: number | null
          calls_issued: number | null
          client_id: string | null
          investors: number | null
          latest_call_no: number | null
          name: string | null
          next_payment_due: string | null
          paid_in_capital: number | null
          total_commitments: number | null
          unfunded_commitment: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      auth_call_ids: { Args: never; Returns: string[] }
      auth_can_write_call: { Args: { target_call: string }; Returns: boolean }
      auth_can_write_client: {
        Args: { target_client: string }
        Returns: boolean
      }
      auth_can_write_firm: { Args: { target_firm: string }; Returns: boolean }
      auth_client_ids: { Args: never; Returns: string[] }
      auth_firm_ids: { Args: never; Returns: string[] }
      save_call_inputs: {
        Args: {
          p_call: Json
          p_call_id: string
          p_components: Json
          p_expected: Json
          p_lps: Json
          p_offsets: Json
          p_sources: Json
          p_transfers: Json
        }
        Returns: undefined
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

