// Single shared Supabase browser client (anon key, RLS-mediated). Null when
// running against the mock data layer.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.ts";

export const supabase: SupabaseClient | null =
  !config.useMock && config.supabaseUrl && config.supabaseAnonKey
    ? createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
