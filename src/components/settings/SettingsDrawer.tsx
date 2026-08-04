import { Drawer } from '@/components/ui/Drawer';
import { SettingsPanel } from './SettingsPanel';
import { useUiStore } from '@/stores/ui.store';

/** 阅读器内的设置抽屉 */
export function SettingsDrawer(): React.JSX.Element {
  const open = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  return (
    <Drawer open={open} onClose={() => setSettingsOpen(false)} title="设置">
      <SettingsPanel />
    </Drawer>
  );
}
