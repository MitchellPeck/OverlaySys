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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          name: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          notes?: string | null;
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
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          project_id: string;
          name: string;
          rows?: Json;
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          name?: string;
          rows?: Json;
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
          updated_at: string;
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
          updated_at?: string;
        };
        Update: {
          project_id?: string;
          name?: string;
          template_id?: string;
          data?: Json;
          channel_hint?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      songs: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
        };
        Update: {
          payload?: Json;
        };
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          payload: Json;
          updated_at?: string;
        };
        Update: {
          payload?: Json;
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
