import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_TITLE, DEFAULT_DEBUG_PANEL, parseAppConfig } from './parseAppConfig.ts';

describe('parseAppConfig', () => {
  it('uses the provided values when they are valid', () => {
    const config = parseAppConfig({
      DEV: true,
      VITE_APP_TITLE: 'Tower',
      VITE_DEBUG_PANEL: 'true',
    });

    expect(config).toEqual({ appTitle: 'Tower', showDebugPanel: true });
  });

  it('trims surrounding whitespace from the title', () => {
    expect(parseAppConfig({ VITE_APP_TITLE: '  Tower  ' }).appTitle).toBe('Tower');
  });

  it('falls back to defaults when variables are missing', () => {
    const config = parseAppConfig({ DEV: true });

    expect(config.appTitle).toBe(DEFAULT_APP_TITLE);
    expect(config.showDebugPanel).toBe(DEFAULT_DEBUG_PANEL);
  });

  it('hides the debug panel outside development even when enabled', () => {
    expect(parseAppConfig({ DEV: false, VITE_DEBUG_PANEL: 'true' }).showDebugPanel).toBe(false);
  });

  it('hides the debug panel in development when disabled', () => {
    expect(parseAppConfig({ DEV: true, VITE_DEBUG_PANEL: 'false' }).showDebugPanel).toBe(false);
  });

  it.each(['', '   '])('rejects a blank title %j', (title) => {
    expect(() => parseAppConfig({ VITE_APP_TITLE: title })).toThrow(/VITE_APP_TITLE/);
  });

  it.each(['yes', '1', 'TRUE', '', 'toString'])('rejects a non-boolean debug flag %j', (flag) => {
    expect(() => parseAppConfig({ VITE_DEBUG_PANEL: flag })).toThrow(
      /Invalid VITE_DEBUG_PANEL: expected "true" or "false"/,
    );
  });
});
