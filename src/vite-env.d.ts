interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  /** Page title shown in the browser tab. Validated in `src/app/config.ts`. */
  readonly VITE_APP_TITLE?: string;
  /** `"true"` or `"false"`: show the Leva debug panel in development. Validated in `src/app/config.ts`. */
  readonly VITE_DEBUG_PANEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
