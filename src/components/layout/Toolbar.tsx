import { Fragment, useMemo } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useToolbarActions, type ToolbarAction } from '@/hooks/useToolbarActions';
import { formatCombo, isMacPlatform } from '@/utils/hotkeys';

/**
 * 低于这个宽度就把次要动作收进「更多」菜单。
 *
 * 这是「舒适度」阈值而不是「硬溢出」阈值——13 个按钮实际到 ~460px 才真正放不下，
 * 但在 640px 以下时工具栏已经顶格排满，视觉上很局促。
 *
 * 用媒体查询而不是「测量后判断是否溢出」：后者会震荡——收起后不再溢出，
 * 于是又展开，展开后再次溢出。工具栏本就横跨整个窗口，窗口宽度即其宽度。
 */
const COLLAPSE_QUERY = '(max-width: 640px)';

/** 拼装按钮的 tooltip：名称 + 快捷键，不可用时改为说明原因 */
function buildTooltip(action: ToolbarAction, isMac: boolean): string {
  if (action.disabledReason) return `${action.label}（${action.disabledReason}）`;
  return action.hotkey ? `${action.label} (${formatCombo(action.hotkey, isMac)})` : action.label;
}

/** 一组动作按钮，组间自动插入分隔线 */
function ActionGroup({
  actions,
  isMac,
}: {
  actions: readonly ToolbarAction[];
  isMac: boolean;
}): React.JSX.Element {
  return (
    <>
      {actions.map((action, index) => {
        const previous = actions[index - 1];
        const needsSeparator = previous !== undefined && previous.group !== action.group;
        return (
          <Fragment key={action.id}>
            {needsSeparator && (
              <div className="mx-1 h-5 w-px" style={{ background: 'var(--app-border-subtle)' }} />
            )}
            <IconButton
              icon={<action.icon size={16} />}
              label={buildTooltip(action, isMac)}
              active={action.active ?? false}
              disabled={action.disabledReason !== undefined}
              onClick={action.onSelect}
            />
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * 顶部工具栏。
 *
 * 按钮全部由 `useToolbarActions()` 声明式产出，本组件只负责排布与
 * 窄窗口下的折叠——新增一个动作不需要动这里。
 */
export function Toolbar(): React.JSX.Element {
  const actions = useToolbarActions();
  const collapsed = useMediaQuery(COLLAPSE_QUERY);
  const isMac = useMemo(() => isMacPlatform(), []);

  const { startActions, endActions, overflowItems } = useMemo(() => {
    const hidden = collapsed ? actions.filter((action) => action.collapsible === true) : [];
    const hiddenIds = new Set(hidden.map((action) => action.id));
    const visible = actions.filter((action) => !hiddenIds.has(action.id));

    return {
      startActions: visible.filter((action) => action.align === 'start'),
      endActions: visible.filter((action) => action.align === 'end'),
      overflowItems: hidden.map<MenuItem>((action) => ({
        id: action.id,
        label: action.label,
        icon: <action.icon size={14} />,
        hint: action.hotkey ? formatCombo(action.hotkey, isMac) : undefined,
        disabled: action.disabledReason !== undefined,
        disabledReason: action.disabledReason,
        onSelect: action.onSelect,
      })),
    };
  }, [actions, collapsed, isMac]);

  return (
    <header
      className="no-print flex h-11 shrink-0 items-center gap-1 border-b px-2"
      style={{ borderColor: 'var(--app-border-subtle)', background: 'var(--app-bg)' }}
    >
      <ActionGroup actions={startActions} isMac={isMac} />
      <div className="flex-1" />
      <ActionGroup actions={endActions} isMac={isMac} />
      {overflowItems.length > 0 && (
        <Menu
          trigger={<MoreHorizontal size={16} />}
          triggerLabel="更多操作"
          items={overflowItems}
        />
      )}
    </header>
  );
}
