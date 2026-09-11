import { Leva } from 'leva';

/** Props of {@link DebugPanel}. */
export interface DebugPanelProps {
  /** Whether the panel is shown. When false it stays mounted but hidden. */
  readonly visible: boolean;
}

/**
 * Leva tweak panel for scene values. Always mounted so Leva does not auto-inject its own
 * panel; hidden unless `visible` is true.
 *
 * @param props - {@link DebugPanelProps}
 * @returns The Leva root.
 */
export function DebugPanel({ visible }: DebugPanelProps) {
  return <Leva hidden={!visible} collapsed />;
}
