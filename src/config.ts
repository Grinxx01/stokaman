import "dotenv/config";

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value.trim();
  }
  return "";
}

export const config = {
  port: Number.parseInt(readEnv("PORT") || "3000", 10),
  supabaseUrl: readEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"),
  supabaseKey: readEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY"
  )
};

if (!config.supabaseUrl || !config.supabaseKey) {
  console.error("SUPABASE_URL dan SUPABASE_KEY wajib diisi di file .env");
  process.exit(1);
}
