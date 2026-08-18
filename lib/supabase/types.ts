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
      trades: {
        Row: {
          id: number;
          ticket: string;
          timestamp: string | null;
          type: string | null;
          symbol: string | null;
          direction: string | null;
          volume: number | null;
          entry: number | null;
          sl: number | null;
          tp: number | null;
          exit: number | null;
          profit: number | null;
          swap: number | null;
          commission: number | null;
          net_pnl: number | null;
          status: string | null;
          signal_reason: string | null;
          strategy: string | null;
          risk: number | null;
          balance_after: number | null;
          notes: string | null;
          meta: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      signals: {
        Row: {
          id: number;
          signal_key: string | null;
          timestamp: string | null;
          symbol: string | null;
          signal: string | null;
          direction: string | null;
          confidence: string | null;
          d1_trend: string | null;
          h1_trend: string | null;
          rsi: number | null;
          atr: number | null;
          entry_zone: string | null;
          sl: number | null;
          tp: number | null;
          status: string | null;
          notes: string | null;
          meta: Record<string, unknown> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      trading_daily: {
        Row: {
          id: number;
          date: string;
          total_trades: number | null;
          wins: number | null;
          losses: number | null;
          winrate: number | null;
          net_pnl: number | null;
          max_drawdown: number | null;
          avg_rr: number | null;
          balance: number | null;
          equity_peak: number | null;
          equity_low: number | null;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      classroom_tasks: {
        Row: {
          id: number;
          task_key: string;
          course_name: string | null;
          course_id: string | null;
          title: string | null;
          due: string | null;
          due_time: string | null;
          state: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      classroom_announcements: {
        Row: {
          id: number;
          ann_key: string;
          course_name: string | null;
          course_id: string | null;
          text: string | null;
          time: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      classroom_meta: {
        Row: { id: number; key: string; value: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}