import { parseAppConfig, type AppConfig } from './parseAppConfig.ts';

/** The application configuration, parsed and validated once from `import.meta.env` at startup. */
export const appConfig: AppConfig = parseAppConfig(import.meta.env);
