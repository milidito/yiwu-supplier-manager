/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_DEFAULT_SUPABASE_URL?: string;
  readonly VITE_DEFAULT_SUPABASE_KEY?: string;
}
