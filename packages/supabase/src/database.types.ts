/**
 * Hand-written types until `supabase gen types typescript` is run against
 * apps-portal's linked Supabase project. Schema mirrors
 * supabase/migrations/0001_init.sql.
 *
 * Regenerate with: `pnpm --filter @overlaysys/supabase gen:types`
 * (requires a linked Supabase project — see docs/cloud-setup.md).
 *
 * Note: OverlaySys's tables live in the `overlaysys` schema in apps-portal's
 * Supabase. We don't model apps-portal's own `public` schema here — clients
 * only need typed access to overlaysys.* tables. The membership check
 * against public.orgs happens inside an RLS helper function.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  overlaysys: {
    Tables: {
      projects: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          notes: string | null;
          song_custom_field_schema: Json | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          name: string;
          notes?: string | null;
          song_custom_field_schema?: Json | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          name?: string;
          notes?: string | null;
          song_custom_field_schema?: Json | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      shows: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          name: string;
          rows: Json;
          /** Every other show-level field (sections, songs, scheduledFor, sermonNotes, …). Optional column; see docs/cloud-slides-sync-migration.md. */
          extra: Json | null;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          project_id: string;
          name: string;
          rows?: Json;
          extra?: Json | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          project_id?: string;
          name?: string;
          rows?: Json;
          extra?: Json | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      hotcards: {
        Row: {
          id: string;
          org_id: string;
          project_id: string;
          name: string;
          template_id: string;
          data: Json;
          channel_hint: string | null;
          notes: string | null;
          /** "F1".."F12", "none" = deliberately unassigned, null = absent. Optional column; see docs/cloud-slides-sync-migration.md. */
          hotkey: string | null;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          project_id: string;
          name: string;
          template_id: string;
          data?: Json;
          channel_hint?: string | null;
          notes?: string | null;
          hotkey?: string | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          project_id?: string;
          name?: string;
          template_id?: string;
          data?: Json;
          channel_hint?: string | null;
          notes?: string | null;
          hotkey?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      songs: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      stage_layouts: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      /** Slides decks (JSON payload). Optional table; see docs/cloud-slides-sync-migration.md. */
      decks: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      /** Media library items (JSON payload). Optional table; see docs/cloud-media-sync-migration.md. */
      media_items: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      /** Remembered PCO item -> deck choices (JSON payload; id = mapping key). Optional table; see docs/cloud-slides-sync-migration.md. */
      pco_item_mappings: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      asset_index: {
        Row: {
          sha256: string;
          org_id: string;
          mime: string | null;
          size: number | null;
          created_at: string;
        };
        Insert: {
          sha256: string;
          org_id: string;
          mime?: string | null;
          size?: number | null;
          created_at?: string;
        };
        Update: {
          mime?: string | null;
          size?: number | null;
        };
        Relationships: [];
      };
      channel_configs: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      project_channel_overrides: {
        Row: {
          org_id: string;
          project_id: string;
          channel_id: string;
          payload: Json;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          org_id: string;
          project_id: string;
          channel_id: string;
          payload: Json;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          payload?: Json;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_org_member: {
        Args: { check_org_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
