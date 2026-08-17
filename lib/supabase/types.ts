// Generated-style Supabase types for the `hidden_tasks` table. Kept minimal and
// hand-written (not via supabase gen types) so the project builds without a
// live Supabase connection.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      hidden_tasks: {
        Row: {
          id: string;
          user_id: string | null;
          task_key: string;
          course: string;
          title: string;
          due: string | null;
          reason: string;
          custom_reason: string | null;
          hidden_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          task_key: string;
          course: string;
          title: string;
          due?: string | null;
          reason: string;
          custom_reason?: string | null;
          hidden_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          task_key?: string;
          course?: string;
          title?: string;
          due?: string | null;
          reason?: string;
          custom_reason?: string | null;
          hidden_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}