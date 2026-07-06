import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASEURL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASEKEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
