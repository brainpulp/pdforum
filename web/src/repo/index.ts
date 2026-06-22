// Repository factory: pick the Supabase-backed repo when a client exists,
// otherwise the in-memory mock.

import { supabase } from "../client.ts";
import { MockRepo } from "./mock.ts";
import { SupabaseRepo } from "./supabase.ts";
import type { Repo } from "./types.ts";

export const repo: Repo = supabase ? new SupabaseRepo(supabase) : new MockRepo();
