import React from 'react';
import { type Task } from '../../types';
import AcceptanceCriteriaProgress, { getAcceptanceCriteriaProgressCounts } from './AcceptanceCriteriaProgress';
import FieldValue from './schema/FieldValue.tsx';
import { useSchema } from './schema/SchemaProvider.tsx';
import type { FieldValue as RegistryFieldValue } from '../../schema/field-registry.ts';
import TaskDisplayTitle, { useTaskDisplay } from './schema/TaskDisplayTitle.tsx';
import { FallbackLanguageCode } from './schema/DisplayLanguageContext.tsx';
import { useSnapshotMode } from '../contexts/SnapshotModeContext.tsx';
import { isTerminalStatus } from '../../utils/terminal-status.ts';

export function getDueUrgencyClass(dueDate: string | undefined, status: string, statuses: readonly string[], now = new Date()): string {
  if (isTerminalStatus(status, statuses)) return '';
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return 'border-l-4 border-l-amber-400 dark:border-l-amber-500';
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  if (!Number.isFinite(due)) return 'border-l-4 border-l-amber-400 dark:border-l-amber-500';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due - today) / 86_400_000);
  if (days < 3) return 'border-l-4 border-l-red-600 dark:border-l-red-500';
  if (days < 7) return 'border-l-4 border-l-red-300 dark:border-l-red-400';
  return 'border-l-4 border-l-emerald-300 dark:border-l-emerald-500';
}

interface TaskCardProps {
  task: Task;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onEdit: (task: Task) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  status?: string;
  laneId?: string;
  availableTypes?: string[];
  availableProjects?: string[];
  dateFormat?: string;
  subtaskProgress?: { completed: number; total: number };
  isSelected?: boolean;
  selectionCount?: number;
  onSelect?: (event: { shiftKey: boolean }) => void;
  isSelectionDragging?: boolean;
  onSelectionDragChange?: (active: boolean) => void;
}

// Dragging a selected card moves the whole selection, so the drag image has to show it. Stacking
// empty cards (up to two) behind a copy of the dragged one, plus the count of every task that will
// move, keeps the board's own card styling.
const buildSelectionDragImage = (source: HTMLElement, count: number): HTMLElement => {
  const width = source.offsetWidth;
  const height = source.offsetHeight;
  const layer = (offset: number) => `position:absolute;top:${offset}px;left:${offset}px;width:${width}px;height:${height}px;margin:0;`;

  const behind = Math.min(count - 1, 2);
  const spread = 6 * behind;
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;top:-1000px;left:-1000px;width:${width + spread}px;height:${height + spread}px;pointer-events:none;`;

  for (let depth = behind; depth >= 1; depth -= 1) {
    const shell = document.createElement('div');
    shell.className = source.className;
    shell.style.cssText = layer(6 * depth);
    ghost.appendChild(shell);
  }

  const front = source.cloneNode(true) as HTMLElement;
  front.style.cssText = layer(0);
  ghost.appendChild(front);

  const badge = document.createElement('div');
  badge.textContent = String(count);
  badge.style.cssText =
    'position:absolute;top:-8px;right:-8px;min-width:24px;height:24px;padding:0 6px;border-radius:9999px;' +
    'background:#3b82f6;color:#ffffff;font-size:12px;font-weight:600;line-height:24px;text-align:center;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.3);';
  ghost.appendChild(badge);

  return ghost;
};

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  onDragStart,
  onDragEnd,
  status,
  laneId,
  dateFormat,
  isSelected = false,
  selectionCount = 0,
  onSelect,
  isSelectionDragging = false,
  onSelectionDragChange,
  subtaskProgress,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const [showBranchTooltip, setShowBranchTooltip] = React.useState(false);
  const { schema, registry } = useSchema();
  const snapshotMode = useSnapshotMode();
  const { resolve, title, showFallback } = useTaskDisplay();
  const cardFields = schema.ui.board.card.filter((key) => schema.fields[key] && !schema.fields[key]?.hidden);
  const fieldValue = (key: string): RegistryFieldValue | undefined => {
    if (schema.fields[key]?.lang || registry.translationGroup(key).length > 1) return resolve(task, key).value;
    const supplied = (task as Task & { fields?: Record<string, RegistryFieldValue> }).fields;
    return supplied?.[key] ?? registry.getField(task, key);
  };
  const badgeFields = cardFields.filter((key) => ['enum', 'bool', 'sequence'].includes(schema.fields[key]?.type ?? ''));
  const listFields = cardFields.filter((key) => ['multi-enum', 'string-list', 'task-ref-list'].includes(schema.fields[key]?.type ?? ''));
  const footerFields = cardFields.filter((key) => !badgeFields.includes(key) && !listFields.includes(key));

  // Check if task is from another branch (read-only)
  const isFromOtherBranch = Boolean(task.branch);
  const acceptanceCriteriaProgress = getAcceptanceCriteriaProgressCounts(task);
  const accessibleLabel = acceptanceCriteriaProgress
    ? `Open ${task.id}: ${String(title(task).value ?? '')}. Acceptance criteria progress: ${acceptanceCriteriaProgress.checked} of ${acceptanceCriteriaProgress.total}`
    : `Open ${task.id}: ${String(title(task).value ?? '')}`;

  const handleDragStart = (e: React.DragEvent) => {
    // Prevent dragging cross-branch tasks
    if (snapshotMode || isFromOtherBranch) {
      e.preventDefault();
      setShowBranchTooltip(true);
      setTimeout(() => setShowBranchTooltip(false), 3000);
      return;
    }

    e.dataTransfer.setData('text/plain', task.id);
    if (status) {
      e.dataTransfer.setData('text/status', status);
    }
    if (laneId !== undefined) {
      e.dataTransfer.setData('text/lane', laneId);
    }
    e.dataTransfer.effectAllowed = 'move';

    // A modifier-press that turns straight into a drag never completes the click, so the selection
    // would miss the very card being dragged and both the badge and the drop would come up one
    // short. Joining the selection here keeps them in agreement with what the user grabbed.
    const joinsSelection = !isSelected && selectionCount > 0 && (e.ctrlKey || e.metaKey) && Boolean(onSelect);
    if (joinsSelection) onSelect?.({ shiftKey: false });
    const batchCount = isSelected ? selectionCount : joinsSelection ? selectionCount + 1 : 1;

    if (batchCount > 1) {
      // The whole selection moves with this drag, so every selected card on the board carries the
      // same dragging treatment as the grabbed one.
      onSelectionDragChange?.(true);
      if (typeof e.dataTransfer.setDragImage === 'function') {
        const ghost = buildSelectionDragImage(e.currentTarget as HTMLElement, batchCount);
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 16, 16);
        // The browser snapshots the element during setDragImage, so it only has to survive this tick.
        setTimeout(() => ghost.remove(), 0);
      }
    }

    setIsDragging(true);
    onDragStart?.();
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    onSelectionDragChange?.(false);
    onDragEnd?.();
  };

  const dueDate = fieldValue('due_date');
  const dueUrgencyClass = getDueUrgencyClass(typeof dueDate === 'string' ? dueDate : undefined, task.status, schema.fields.status?.values ?? []);

  return (
    <div className="relative">
      {/* Branch tooltip when trying to drag cross-branch task */}
      {showBranchTooltip && isFromOtherBranch && (
        <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 z-50 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-md shadow-lg whitespace-nowrap">
          <div className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Switch to <span className="font-semibold text-amber-300">{task.branch}</span> branch to move this task
          </div>
          <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900 dark:bg-gray-700"></div>
        </div>
      )}

      <div
        className={`bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md p-3 mb-2 transition-all duration-200 ${
          isFromOtherBranch 
            ? 'opacity-75 cursor-not-allowed border-dashed' 
            : 'cursor-pointer hover:shadow-md dark:hover:shadow-lg hover:border-stone-500 dark:hover:border-stone-400'
        } ${dueUrgencyClass} ${
          isDragging || (isSelected && isSelectionDragging) ? 'opacity-50 transform rotate-2 scale-105' : ''
        } ${
          isSelected
            ? 'ring-2 ring-blue-500 dark:ring-blue-400 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
            : ''
        }`}
        aria-selected={isSelected}
        draggable={!snapshotMode && !isFromOtherBranch}
		role="button"
		tabIndex={0}
		aria-label={accessibleLabel}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={(event) => {
          // Ctrl/Cmd and Shift belong to the board selection, so they must not open the editor.
          if (onSelect && !isFromOtherBranch && (event.ctrlKey || event.metaKey || event.shiftKey)) {
            event.preventDefault();
            event.stopPropagation();
            onSelect({ shiftKey: event.shiftKey });
            return;
          }
          onEdit(task);
        }}
		onKeyDown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				if (onSelect && !isFromOtherBranch && (event.ctrlKey || event.metaKey || event.shiftKey)) {
					onSelect({ shiftKey: event.shiftKey });
					return;
				}
				onEdit(task);
			}
		}}
      >
        {/* Cross-branch indicator banner */}
        {isFromOtherBranch && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 -mx-1 -mt-1 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 rounded-t text-xs text-amber-700 dark:text-amber-300">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="truncate">
              From <span className="font-semibold">{task.branch}</span> branch
            </span>
          </div>
        )}

        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="shrink-0 font-mono text-xs text-gray-400 transition-colors duration-200 dark:text-gray-500">{task.id.replace(/^TASK-/i, 'T-')}</span>
          {(subtaskProgress || acceptanceCriteriaProgress && acceptanceCriteriaProgress.total > 1) && <span className="flex items-center gap-2">
            {subtaskProgress && <span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium tabular-nums text-blue-600 dark:text-blue-300" role="progressbar" aria-label="Subtask progress" aria-valuemin={0} aria-valuemax={subtaskProgress.total} aria-valuenow={subtaskProgress.completed} title={`${subtaskProgress.completed} of ${subtaskProgress.total} subtasks complete`}><svg className="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 1.5h4l2 2V10.5H3z" /><path d="M7 1.5v2h2M4.5 6h3M4.5 8h3" /></svg>{subtaskProgress.completed}/{subtaskProgress.total}</span>}
            {acceptanceCriteriaProgress && acceptanceCriteriaProgress.total > 1 && <AcceptanceCriteriaProgress task={task} density="card" />}
          </span>}
        </div>
        {badgeFields.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {badgeFields.map((key) => { const display = resolve(task, key); return <span key={key}><FieldValue fieldKey={key} value={fieldValue(key)} variant="card" overdue={task.overdue?.includes(key)} />{showFallback(display.fallback) && <FallbackLanguageCode lang={display.lang} />}</span>; })}
        </div>}

        {/* Title */}
        <h4 className={`font-semibold text-sm line-clamp-2 transition-colors duration-200 ${
          isFromOtherBranch
            ? 'text-gray-600 dark:text-gray-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}>
          <TaskDisplayTitle task={task} />
        </h4>

        {listFields.map((key) => { const value = fieldValue(key); const display = resolve(task, key); return value && (!Array.isArray(value) || value.length) ? <div key={key} className="flex flex-wrap gap-1 mt-2"><FieldValue fieldKey={key} value={value} variant="card" overdue={task.overdue?.includes(key)} />{showFallback(display.fallback) && <FallbackLanguageCode lang={display.lang} />}</div> : null; })}

        {/* Footer with dates and assignee */}
        <div className="mt-2 flex flex-col items-start gap-0.5 border-t border-gray-100 pt-1.5 text-[10px] text-gray-400 transition-colors duration-200 dark:border-gray-600/50 dark:text-gray-500">
          {footerFields.map((key) => {
            const value = fieldValue(key);
            if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
            const label = key === 'created_date' ? '' : key === 'updated_date' ? 'Updated: ' : key === 'due_date' ? 'Due: ' : `${schema.fields[key]?.label ?? key}: `;
            const display = resolve(task, key);
            return <span key={key}>{label}<FieldValue fieldKey={key} value={value} variant="card" dateFormat={dateFormat} overdue={task.overdue?.includes(key)} />{showFallback(display.fallback) && <FallbackLanguageCode lang={display.lang} />}</span>;
          })}
        </div>
      </div>
    </div>
  );
};

export default TaskCard;
