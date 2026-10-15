export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  core: {
    Tables: {
      client_errors: {
        Row: {
          created_at: string
          digest: string | null
          id: string
          message: string
          occurred_at: string
          route: string
          stack: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          digest?: string | null
          id?: string
          message: string
          occurred_at?: string
          route: string
          stack?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          digest?: string | null
          id?: string
          message?: string
          occurred_at?: string
          route?: string
          stack?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      connections: {
        Row: {
          created_at: string
          credentials_encrypted: string
          expires_at: string | null
          id: string
          integration_id: string
          last_test_detail: string | null
          last_tested_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credentials_encrypted: string
          expires_at?: string | null
          id?: string
          integration_id: string
          last_test_detail?: string | null
          last_tested_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credentials_encrypted?: string
          expires_at?: string | null
          id?: string
          integration_id?: string
          last_test_detail?: string | null
          last_tested_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_summary: {
        Row: {
          created_at: string
          headline: string | null
          id: string
          notified_at: string | null
          run_at: string
          summary: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          headline?: string | null
          id?: string
          notified_at?: string | null
          run_at?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          headline?: string | null
          id?: string
          notified_at?: string | null
          run_at?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      digests: {
        Row: {
          created_at: string
          id: string
          module: string
          payload: Json
          run_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          module: string
          payload?: Json
          run_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          module?: string
          payload?: Json
          run_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      embeddings: {
        Row: {
          content_hash: string
          created_at: string
          embedded_at: string | null
          embedding: string | null
          entity_id: string
          id: string
          tsv: unknown
          updated_at: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          embedded_at?: string | null
          embedding?: string | null
          entity_id: string
          id?: string
          tsv?: unknown
          updated_at?: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          embedded_at?: string | null
          embedding?: string | null
          entity_id?: string
          id?: string
          tsv?: unknown
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "embeddings_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: true
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          module: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          module: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          module?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          entity_ref: string | null
          event_type: string
          id: string
          module: string
          occurred_at: string
          payload: Json
          title_snapshot: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_ref?: string | null
          event_type: string
          id?: string
          module: string
          occurred_at?: string
          payload?: Json
          title_snapshot: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_ref?: string | null
          event_type?: string
          id?: string
          module?: string
          occurred_at?: string
          payload?: Json
          title_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_entity_ref_fkey"
            columns: ["entity_ref"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          finished_at: string | null
          id: string
          log: Json
          started_at: string
          status: string
          trigger_source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          log?: Json
          started_at?: string
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          log?: Json
          started_at?: string
          status?: string
          trigger_source?: string
          updated_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          created_at: string
          id: string
          last_run: string | null
          last_status: string | null
          log: Json
          module: string
          name: string
          schedule: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_run?: string | null
          last_status?: string | null
          log?: Json
          module: string
          name: string
          schedule?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_run?: string | null
          last_status?: string | null
          log?: Json
          module?: string
          name?: string
          schedule?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      llm_calls: {
        Row: {
          cost_cents: number
          created_at: string
          id: string
          input_tokens: number
          model: string
          module: string | null
          occurred_at: string
          output_tokens: number
          purpose: string
          updated_at: string
          web_searches: number
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model: string
          module?: string | null
          occurred_at?: string
          output_tokens?: number
          purpose: string
          updated_at?: string
          web_searches?: number
        }
        Update: {
          cost_cents?: number
          created_at?: string
          id?: string
          input_tokens?: number
          model?: string
          module?: string | null
          occurred_at?: string
          output_tokens?: number
          purpose?: string
          updated_at?: string
          web_searches?: number
        }
        Relationships: []
      }
      notification_rules: {
        Row: {
          channels: string[]
          created_at: string
          id: string
          key: string
          label: string
          lead_days: number
          module: string
          muted: boolean
          position: number
          sample_body: string
          sample_title: string
          snooze_until: string | null
          timing: string
          trigger_text: string
          updated_at: string
          urgent: boolean
        }
        Insert: {
          channels?: string[]
          created_at?: string
          id?: string
          key: string
          label: string
          lead_days?: number
          module: string
          muted?: boolean
          position?: number
          sample_body?: string
          sample_title?: string
          snooze_until?: string | null
          timing?: string
          trigger_text: string
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          channels?: string[]
          created_at?: string
          id?: string
          key?: string
          label?: string
          lead_days?: number
          module?: string
          muted?: boolean
          position?: number
          sample_body?: string
          sample_title?: string
          snooze_until?: string | null
          timing?: string
          trigger_text?: string
          updated_at?: string
          urgent?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          channel: string
          created_at: string
          digest_run_id: string | null
          due_at: string
          href: string | null
          id: string
          read_at: string | null
          rule_id: string | null
          sent_at: string | null
          snooze_until: string | null
          title: string
          updated_at: string
          urgency: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          digest_run_id?: string | null
          due_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          rule_id?: string | null
          sent_at?: string | null
          snooze_until?: string | null
          title: string
          updated_at?: string
          urgency?: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          digest_run_id?: string | null
          due_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          rule_id?: string | null
          sent_at?: string | null
          snooze_until?: string | null
          title?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_digest_run_id_fkey"
            columns: ["digest_run_id"]
            isOneToOne: false
            referencedRelation: "job_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          affects: string | null
          agent: string | null
          confidence: number | null
          created_at: string
          decided_at: string | null
          diff: Json
          dismissed_until: string | null
          evidence: string | null
          guarded: boolean
          id: string
          module: string
          payload: Json
          reason: string | null
          status: string
          title: string | null
          tool: string
          updated_at: string
        }
        Insert: {
          affects?: string | null
          agent?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          diff?: Json
          dismissed_until?: string | null
          evidence?: string | null
          guarded?: boolean
          id?: string
          module: string
          payload?: Json
          reason?: string | null
          status?: string
          title?: string | null
          tool: string
          updated_at?: string
        }
        Update: {
          affects?: string | null
          agent?: string | null
          confidence?: number | null
          created_at?: string
          decided_at?: string | null
          diff?: Json
          dismissed_until?: string | null
          evidence?: string | null
          guarded?: boolean
          id?: string
          module?: string
          payload?: Json
          reason?: string | null
          status?: string
          title?: string | null
          tool?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscription: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          label: string
          last_sent_at: string | null
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          label?: string
          last_sent_at?: string | null
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          label?: string
          last_sent_at?: string | null
          p256dh?: string
          updated_at?: string
        }
        Relationships: []
      }
      request_log: {
        Row: {
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          ip_hash: string | null
          method: string
          occurred_at: string
          route: string
          status: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_ms: number
          error?: string | null
          id?: string
          ip_hash?: string | null
          method: string
          occurred_at?: string
          route: string
          status: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          ip_hash?: string | null
          method?: string
          occurred_at?: string
          route?: string
          status?: number
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          answers: Json
          closed_at: string | null
          created_at: string
          id: string
          note_ref: string | null
          priorities: string[]
          updated_at: string
          week_of: string
        }
        Insert: {
          answers?: Json
          closed_at?: string | null
          created_at?: string
          id?: string
          note_ref?: string | null
          priorities?: string[]
          updated_at?: string
          week_of: string
        }
        Update: {
          answers?: Json
          closed_at?: string | null
          created_at?: string
          id?: string
          note_ref?: string | null
          priorities?: string[]
          updated_at?: string
          week_of?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_note_ref_fkey"
            columns: ["note_ref"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      skill_links: {
        Row: {
          classified_by: string
          confidence: number
          created_at: string
          entity_ref: string
          id: string
          is_manual: boolean
          skill_id: string
          updated_at: string
          weight: number
        }
        Insert: {
          classified_by: string
          confidence?: number
          created_at?: string
          entity_ref: string
          id?: string
          is_manual?: boolean
          skill_id: string
          updated_at?: string
          weight?: number
        }
        Update: {
          classified_by?: string
          confidence?: number
          created_at?: string
          entity_ref?: string
          id?: string
          is_manual?: boolean
          skill_id?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "skill_links_entity_ref_fkey"
            columns: ["entity_ref"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      write_log: {
        Row: {
          actor: string
          apply_payload: Json | null
          created_at: string
          diff: Json
          entity_ref: string | null
          id: string
          kind: string
          module: string
          reason: string
          revert_payload: Json | null
          run_id: string | null
          title: string
          tool: string
          undone_at: string | null
          updated_at: string
        }
        Insert: {
          actor?: string
          apply_payload?: Json | null
          created_at?: string
          diff?: Json
          entity_ref?: string | null
          id?: string
          kind: string
          module: string
          reason: string
          revert_payload?: Json | null
          run_id?: string | null
          title: string
          tool: string
          undone_at?: string | null
          updated_at?: string
        }
        Update: {
          actor?: string
          apply_payload?: Json | null
          created_at?: string
          diff?: Json
          entity_ref?: string | null
          id?: string
          kind?: string
          module?: string
          reason?: string
          revert_payload?: Json | null
          run_id?: string | null
          title?: string
          tool?: string
          undone_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "write_log_entity_ref_fkey"
            columns: ["entity_ref"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "write_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "job_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      today: { Args: never; Returns: string }
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
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  core: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

