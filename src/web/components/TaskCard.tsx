import React from 'react';
import { type Task } from '../../types';
import AcceptanceCriteriaProgress, { getAcceptanceCriteriaProgressCounts } from './AcceptanceCriteriaProgress';
import FieldValue from './schema/FieldValue.tsx';
import { useSchema } from './schema/SchemaProvider.tsx';
import type { FieldValue as RegistryFieldValue } from '../../schema/field-registry.ts';

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
}) => {
  const [isDragging, setIsDragging] = React.useState(false);
  const [showBranchTooltip, setShowBranchTooltip] = React.useState(false);
  const { schema, registry } = useSchema();
  const cardFields = schema.ui.board.card.filter((key) => schema.fields[key] && !schema.fields[key]?.hidden);
  const fieldValue = (key: string): RegistryFieldValue | undefined => {
    const supplied = (task as Task & { fields?: Record<string, RegistryFieldValue> }).fields;
    return supplied?.[key] ?? registry.getField(task, key);
  };
  const badgeFields = [...new Set([...cardFields.filter((key) => key !== 'priority' && (schema.fields[key]?.type === 'enum' || schema.fields[key]?.type === 'bool')), ...Object.keys(schema.fields).filter((key) => schema.fields[key]?.type === 'sequence' && !schema.fields[key]?.hidden)])];
  const listFields = cardFields.filter((key) => ['multi-enum', 'string-list', 'task-ref-list'].includes(schema.fields[key]?.type ?? ''));
  const footerFields = cardFields.filter((key) => !badgeFields.includes(key) && key !== 'priority' && !listFields.includes(key));
  const adjacentDateFields = footerFields.filter((key) => key === 'created_date' || key === 'updated_date');
  const trailingFields = footerFields.filter((key) => key !== 'created_date' && key !== 'updated_date');

  // Check if task is from another branch (read-only)
  const isFromOtherBranch = Boolean(task.branch);
  const acceptanceCriteriaProgress = getAcceptanceCriteriaProgressCounts(task);
  const accessibleLabel = acceptanceCriteriaProgress
    ? `Open ${task.id}: ${task.title}. Acceptance criteria progress: ${acceptanceCriteriaProgress.checked} of ${acceptanceCriteriaProgress.total}`
    : `Open ${task.id}: ${task.title}`;

  const handleDragStart = (e: React.DragEvent) => {
    // Prevent dragging cross-branch tasks
    if (isFromOtherBranch) {
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

  const getPriorityClass = (priority?: string) => {
    switch (priority) {
      case 'high': return 'border-l-4 border-l-red-500 dark:border-l-red-400';
      case 'medium': return 'border-l-4 border-l-yellow-500 dark:border-l-yellow-400';
      case 'low': return 'border-l-4 border-l-green-500 dark:border-l-green-400';
      default: return 'border-l-4 border-l-gray-300 dark:border-l-gray-600';
    }
  };

  const priorityValue = cardFields.includes('priority') ? fieldValue('priority') : undefined;

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
        } ${getPriorityClass(typeof priorityValue === 'string' ? priorityValue : undefined)} ${
          isDragging || (isSelected && isSelectionDragging) ? 'opacity-50 transform rotate-2 scale-105' : ''
        } ${
          isSelected
            ? 'ring-2 ring-blue-500 dark:ring-blue-400 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
            : ''
        }`}
        aria-selected={isSelected}
        draggable={!isFromOtherBranch}
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

        {/* Header row with task metadata. It wraps like the footer: when the id, the badges and the
            ring and priority group do not fit on one line, the group moves to a second line, still
            flush right, so the badges are not squeezed to make room for it. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 font-mono transition-colors duration-200">{task.id}</span>
            {badgeFields.map((key) => <FieldValue key={key} fieldKey={key} value={fieldValue(key)} variant="card" overdue={task.overdue?.includes(key)} />)}
          </div>
          {(acceptanceCriteriaProgress || priorityValue) && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AcceptanceCriteriaProgress task={task} density="card" />
              {priorityValue !== undefined && <FieldValue fieldKey="priority" value={priorityValue} variant="card" />}
            </div>
          )}
        </div>

        {/* Title */}
        <h4 className={`font-semibold text-sm line-clamp-2 transition-colors duration-200 ${
          isFromOtherBranch
            ? 'text-gray-600 dark:text-gray-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}>
          {task.title}
        </h4>

        {listFields.map((key) => { const value = fieldValue(key); return value && (!Array.isArray(value) || value.length) ? <div key={key} className="flex flex-wrap gap-1 mt-2"><FieldValue fieldKey={key} value={value} variant="card" overdue={task.overdue?.includes(key)} /></div> : null; })}

        {/* Footer with dates and assignee */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-gray-400 dark:text-gray-500 mt-2 pt-1.5 border-t border-gray-100 dark:border-gray-600/50 transition-colors duration-200">
          {/* Grouped so the updated date sits beside the created date on every card, whatever else the footer shows.
              The group uses the same gaps as the footer row (gap-x-2 gap-y-1), so change the two together.
              A new labelled date in the compact style belongs inside this group. */}
          <span className="flex flex-wrap gap-x-2 gap-y-1">{adjacentDateFields.map((key) => {
            const value = fieldValue(key);
            if (value === undefined || value === null || value === '') return null;
            return <span key={key}>{key === 'updated_date' ? 'Updated: ' : ''}<FieldValue fieldKey={key} value={value} variant="card" dateFormat={dateFormat} overdue={task.overdue?.includes(key)} /></span>;
          })}</span>
          {trailingFields.map((key) => {
            const value = fieldValue(key);
            if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
            const label = key === 'created_date' ? '' : key === 'updated_date' ? 'Updated: ' : key === 'due_date' ? 'Due: ' : `${schema.fields[key]?.label ?? key}: `;
            return <span key={key}>{label}<FieldValue fieldKey={key} value={value} variant="card" dateFormat={dateFormat} overdue={task.overdue?.includes(key)} /></span>;
          })}
        </div>
      </div>
    </div>
  );
};

export default TaskCard;
