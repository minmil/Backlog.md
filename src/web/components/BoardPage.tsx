import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Board from './Board';
import { type Milestone, type Task } from '../../types';
import { resolveProjectValue } from '../../utils/project-config';
import { resolveTaskTypeValue } from '../../utils/task-type-config';
import { type LaneMode } from '../lib/lanes';
import { useSchema } from './schema/SchemaProvider.tsx';
import type { FieldValue as RegistryFieldValue } from '../../schema/field-registry.ts';

interface BoardPageProps {
	onEditTask: (task: Task) => void;
	onNewTask: () => void;
	tasks: Task[];
	onRefreshData?: () => Promise<void>;
	onTasksUpdated?: (tasks: Task[], requestTask: Task) => void;
	statuses: string[];
	milestones: string[];
	availableLabels: string[];
	milestoneEntities: Milestone[];
	archivedMilestones: Milestone[];
	isLoading: boolean;
	loadingMessage?: string | null;
	loadError?: Error | null;
	hideEmptyColumns?: boolean;
	dateFormat?: string;
	availablePriorities?: string[];
	availableTypes?: string[];
	availableProjects?: string[];
}

export default function BoardPage({
	onEditTask,
	onNewTask,
	tasks,
	onRefreshData,
	onTasksUpdated,
	statuses,
	milestones,
	availableLabels,
	milestoneEntities,
	archivedMilestones,
	isLoading,
	loadingMessage,
	loadError,
	hideEmptyColumns,
	dateFormat,
	availablePriorities,
	availableTypes,
	availableProjects,
}: BoardPageProps) {
	const { schema } = useSchema();
	const [searchParams, setSearchParams] = useSearchParams();
	const schemaFilterKeys = schema.ui.board.filters.filter((key) => schema.fields[key] && !schema.fields[key]?.hidden);
	const schemaFilters = Object.fromEntries(schemaFilterKeys.map((key) => {
		const field = schema.fields[key];
		const raw = searchParams.get(key) ?? (key === 'labels' ? searchParams.getAll('label').join(',') : '');
		if (!raw) return [key, null];
		if (key !== 'assignee' && (field?.type === 'string-list' || field?.type === 'multi-enum' || field?.type === 'user-list')) return [key, raw.split(',').map((value) => value.trim()).filter(Boolean)];
		if (field?.type === 'enum') return [key, field.values?.find((value) => value.toLowerCase() === raw.toLowerCase()) ?? null];
		if (field?.type === 'number') return [key, Number(raw)];
		if (field?.type === 'bool') return [key, raw === 'true' ? true : raw === 'false' ? false : null];
		return [key, raw];
	})) as Record<string, RegistryFieldValue | null>;
	const handleSchemaFilterChange = (key: string, value: RegistryFieldValue | null) => {
		setSearchParams((params) => {
			params.delete(key);
			if (key === 'labels') params.delete('label');
			if (value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
			return params;
		}, { replace: true });
	};
	const handleSchemaFiltersClear = () => {
		setSearchParams((params) => {
			for (const key of schemaFilterKeys) params.delete(key);
			params.delete('label');
			return params;
		}, { replace: true });
	};
	useEffect(() => {
		if (isLoading) return;
		const corrections = schemaFilterKeys.flatMap((key) => {
			if (schema.fields[key]?.type !== 'enum' || ['priority', 'type', 'project'].includes(key)) return [];
			const raw = searchParams.get(key);
			if (!raw) return [];
			const canonical = schema.fields[key]?.values?.find((value) => value.toLowerCase() === raw.toLowerCase()) ?? null;
			return canonical === raw ? [] : [{ key, canonical }];
		});
		if (!corrections.length) return;
		setSearchParams((params) => {
			for (const { key, canonical } of corrections) {
				if (canonical) params.set(key, canonical);
				else params.delete(key);
			}
			return params;
		}, { replace: true });
	}, [schema, searchParams, isLoading, setSearchParams]);
	const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
	const [laneMode, setLaneMode] = useState<LaneMode>('none');
	const [milestoneFilter, setMilestoneFilter] = useState<string | null>(null);
	const laneStorageKey = 'backlog.board.lane';

	useEffect(() => {
		const storedLane = typeof window !== 'undefined' ? window.localStorage.getItem(laneStorageKey) : null;
		const paramLane = searchParams.get('lane');
		const paramMilestone = searchParams.get('milestone');
		const parseLane = (value: string | null): LaneMode | null => {
			if (value === 'milestone') return 'milestone';
			if (value === 'none') return 'none';
			return null;
		};
		const nextLane = parseLane(paramLane) ?? parseLane(storedLane) ?? 'none';
		setLaneMode((current) => (current === nextLane ? current : nextLane));
		setMilestoneFilter(paramMilestone);
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(laneStorageKey, nextLane);
		}
	}, [searchParams]);

	useEffect(() => {
		const highlight = searchParams.get('highlight');
		if (highlight) {
			setHighlightTaskId(highlight);
			// Clear the highlight parameter after setting it
			setSearchParams(params => {
				params.delete('highlight');
				return params;
			}, { replace: true });
		}
	}, [searchParams, setSearchParams]);

	// Clear highlight after it's been used
	const handleEditTask = (task: Task) => {
		setHighlightTaskId(null); // Clear highlight so popup doesn't reopen
		onEditTask(task);
	};

	const handleLaneChange = (mode: LaneMode) => {
		setLaneMode(mode);
		setMilestoneFilter(null); // Clear milestone filter when switching lane modes
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(laneStorageKey, mode);
		}
		setSearchParams(params => {
			if (mode === 'none') {
				params.delete('lane');
			} else {
				params.set('lane', mode);
			}
			params.delete('milestone'); // Clear milestone param when switching
			return params;
		}, { replace: true });
	};

	const handleFiltersChange = (filters: { assignee: string; labels: string[]; priority: string; taskType: string; project: string }) => {
		setSearchParams(params => {
			if (filters.assignee) {
				params.set('assignee', filters.assignee);
			} else {
				params.delete('assignee');
			}
			params.delete('label');
			params.delete('labels');
			for (const label of filters.labels) {
				const normalized = label.trim();
				if (normalized) {
					params.append('label', normalized);
				}
			}
			if (filters.priority) {
				params.set('priority', filters.priority);
			} else {
				params.delete('priority');
			}
			if (filters.taskType) {
				params.set('type', filters.taskType);
			} else {
				params.delete('type');
			}
			if (filters.project) {
				params.set('project', filters.project);
			} else {
				params.delete('project');
			}
			return params;
		}, { replace: true });
	};

	const filterAssignee = searchParams.get('assignee') ?? '';
	const filterLabels = [
		...searchParams.getAll('label'),
		...searchParams.getAll('labels').flatMap((value) => value.split(',')),
	].map((label) => label.trim()).filter((label) => label.length > 0);
	const rawFilterPriority = searchParams.get('priority') ?? '';
	const filterPriority = schema.fields.priority?.values?.find((value) => value.toLowerCase() === rawFilterPriority.toLowerCase()) ?? '';
	const rawFilterType = searchParams.get('type') ?? '';
	const filterType = resolveTaskTypeValue(rawFilterType, schema.fields.type?.values) ?? '';
	const rawFilterProject = searchParams.get('project') ?? '';
	const filterProject = resolveProjectValue(rawFilterProject, schema.fields.project?.values) ?? '';

	useEffect(() => {
		if (
			isLoading ||
			(rawFilterPriority === filterPriority && rawFilterType === filterType && rawFilterProject === filterProject)
		) {
			return;
		}
		setSearchParams(params => {
			if (filterPriority) {
				params.set('priority', filterPriority);
			} else {
				params.delete('priority');
			}
			if (filterType) {
				params.set('type', filterType);
			} else {
				params.delete('type');
			}
			if (filterProject) {
				params.set('project', filterProject);
			} else {
				params.delete('project');
			}
			return params;
		}, { replace: true });
	}, [
		filterPriority,
		filterType,
		filterProject,
		isLoading,
		rawFilterPriority,
		rawFilterType,
		rawFilterProject,
		setSearchParams,
	]);

	return (
		<div className="page-shell transition-colors duration-200">
			<Board
				onEditTask={handleEditTask}
				onNewTask={onNewTask}
				highlightTaskId={highlightTaskId}
				tasks={tasks}
				onRefreshData={onRefreshData}
				onTasksUpdated={onTasksUpdated}
				statuses={statuses}
				milestones={milestones}
				milestoneEntities={milestoneEntities}
				archivedMilestones={archivedMilestones}
				isLoading={isLoading}
				loadingMessage={loadingMessage}
				loadError={loadError}
				availableLabels={availableLabels}
				laneMode={laneMode}
				onLaneChange={handleLaneChange}
				milestoneFilter={milestoneFilter}
				filterAssignee={filterAssignee}
				filterLabels={filterLabels}
				filterPriority={filterPriority}
				availablePriorities={availablePriorities}
				filterType={filterType}
				availableTypes={availableTypes}
				filterProject={filterProject}
				schemaFilters={schemaFilters}
				onSchemaFilterChange={handleSchemaFilterChange}
				onSchemaFiltersClear={handleSchemaFiltersClear}
				availableProjects={availableProjects}
				onFiltersChange={handleFiltersChange}
				hideEmptyColumns={hideEmptyColumns}
				dateFormat={dateFormat}
			/>
		</div>
	);
}
