import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../lib/api";
import type {
	Milestone,
	Task,
	TaskSearchResult,
} from "../../types";
import { DEFAULT_STATUSES } from "../../constants/index.ts";
import { collectAvailableLabels } from "../../utils/label-filter.ts";
import { compareTaskIds, compareTaskIdsDescending } from "../../utils/task-sorting.ts";
import { isTerminalStatus } from "../../utils/terminal-status.ts";
import { collectArchivedMilestoneKeys, getMilestoneLabel, milestoneKey } from "../utils/milestones";
import {
	formatPriorityLabel,
	getPriorityOptions,
	resolvePriorityValue,
} from "../../utils/priority-config.ts";
import type { FieldValue as RegistryFieldValue } from "../../schema/field-registry.ts";
import FieldValue from "./schema/FieldValue.tsx";
import FieldFilter from "./schema/FieldFilter.tsx";
import { useSchema } from "./schema/SchemaProvider.tsx";
import CleanupModal from "./CleanupModal";
import StoredDate from "./StoredDate";
import AcceptanceCriteriaProgress, { getAcceptanceCriteriaProgressCounts } from "./AcceptanceCriteriaProgress";
import LabelFilterDropdown from "./LabelFilterDropdown";
import { SuccessToast } from "./SuccessToast";

interface TaskListProps {
	onEditTask: (task: Task) => void;
	onNewTask: () => void;
	tasks: Task[];
	availableStatuses: string[];
	availableLabels: string[];
	availableMilestones: string[];
	availablePriorities?: string[];
	milestoneEntities: Milestone[];
	archivedMilestones: Milestone[];
	onRefreshData?: () => Promise<void>;
	dateFormat?: string;
	isLoading?: boolean;
}

type TaskSortColumn = string;
type SortDirection = "asc" | "desc";

// Column widths in rem, in render order: ID, Title, Status, Priority, Ordinal, Labels,
// Assignee, Milestone, Created. Each metadata column is sized to the wider of its header
// label and its cell content; Title is the one flexible column (null) and absorbs whatever
// the content area has left, so the table fits a laptop viewport instead of overflowing it.
const FIELD_WIDTHS_REM: Record<string, number> = { status: 6.5, priority: 6.5, ordinal: 6, labels: 8, assignee: 6.5, milestone: 8, created_date: 6 };

// Below this the table scrolls horizontally rather than crushing the columns.
const TASK_TITLE_MIN_WIDTH_REM = 12;

function compareTaskIdsAscending(a: Task, b: Task): number {
	return compareTaskIds(a.id, b.id);
}

function sortTasksByIdDescending(list: Task[]): Task[] {
	return [...list].sort((a, b) => compareTaskIdsDescending(a.id, b.id));
}

function getAssigneeInitials(value: string): string {
	const cleaned = value.replace(/^@/, "").trim();
	if (!cleaned) return "?";
	const parts = cleaned
		.split(/[\s._-]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) return cleaned.slice(0, 2).toUpperCase();
	const first = parts[0] ?? "";
	if (parts.length === 1) return first.slice(0, 2).toUpperCase();
	const second = parts[1] ?? "";
	return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function getStatusFilters(searchParams: URLSearchParams): string[] {
	return searchParams
		.getAll("status")
		.map((status) => status.trim())
		.filter((status) => status.length > 0);
}

function normalizeStatusFilters(statuses: string[], availableStatuses: string[]): string[] {
	const canonicalStatuses = new Map(
		availableStatuses
			.map((status) => status.trim())
			.filter((status) => status.length > 0)
			.map((status) => [status.toLowerCase(), status] as const),
	);
	const seen = new Set<string>();

	return statuses.reduce<string[]>((normalized, status) => {
		const trimmed = status.trim();
		if (!trimmed) return normalized;
		const canonical = canonicalStatuses.get(trimmed.toLowerCase()) ?? trimmed;
		const key = canonical.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			normalized.push(canonical);
		}
		return normalized;
	}, []);
}

function areEqualStringArrays(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

const TaskList: React.FC<TaskListProps> = ({
	onEditTask,
	onNewTask,
	tasks,
	availableStatuses,
	availableLabels,
	availableMilestones,
	availablePriorities,
	milestoneEntities,
	archivedMilestones,
	onRefreshData,
	dateFormat,
	isLoading = false,
}) => {
	const { schema, registry } = useSchema();
	const columnKeys = schema.ui.task_list.columns.filter((key) => schema.fields[key] && !schema.fields[key]?.hidden);
	const filterKeys = schema.ui.task_list.filters.filter((key) => schema.fields[key] && !schema.fields[key]?.hidden);
	const customFilterKeys = filterKeys.filter((key) => !["status", "priority", "milestone", "labels"].includes(key));
	const columnWidths = [6, null, ...columnKeys.map((key) => FIELD_WIDTHS_REM[key] ?? 8)] as const;
	const tableMinWidth = columnWidths.reduce<number>((total, width) => total + (width ?? TASK_TITLE_MIN_WIDTH_REM), 0);
	const fieldValue = (task: Task, key: string): RegistryFieldValue | undefined => {
		const supplied = (task as Task & { fields?: Record<string, RegistryFieldValue> }).fields;
		return supplied?.[key] ?? registry.getField(task, key);
	};
	const [searchParams, setSearchParams] = useSearchParams();
	const priorityOrder = availablePriorities?.length ? availablePriorities : (schema.fields.priority?.values ?? []);
	const statusOptions = useMemo(
		() => (availableStatuses.length > 0 ? availableStatuses : schema.fields.status?.values ?? [...DEFAULT_STATUSES]),
		[availableStatuses, schema],
	);
	const [statusFilter, setStatusFilter] = useState<string[]>(() =>
		normalizeStatusFilters(getStatusFilters(searchParams), statusOptions),
	);
	const initialExcludeStatusParams = useMemo(() => {
		const statuses = [...searchParams.getAll("excludeStatus")];
		const statusesCsv = searchParams.get("excludeStatuses");
		if (statusesCsv) statuses.push(...statusesCsv.split(","));
		return statuses.map((status) => status.trim()).filter((status) => status.length > 0);
	}, []);
	const [excludedStatusFilter, setExcludedStatusFilter] = useState<string[]>(initialExcludeStatusParams);
	const [priorityFilter, setPriorityFilter] = useState<string>(() =>
		isLoading ? "" : (resolvePriorityValue(searchParams.get("priority"), priorityOrder) ?? ""),
	);
	const [milestoneFilter, setMilestoneFilter] = useState(() => searchParams.get("milestone") ?? "");
	const initialLabelParams = useMemo(() => {
		const labels = [...searchParams.getAll("label"), ...searchParams.getAll("labels")];
		const labelsCsv = searchParams.get("labels");
		if (labelsCsv) labels.push(...labelsCsv.split(","));
		return labels.map((label) => label.trim()).filter((label) => label.length > 0);
	}, []);
	const [labelFilter, setLabelFilter] = useState<string[]>(initialLabelParams);
	const [displayTasks, setDisplayTasks] = useState<Task[]>(() => sortTasksByIdDescending(tasks));
	const [error, setError] = useState<string | null>(null);
	const [showCleanupModal, setShowCleanupModal] = useState(false);
	const [cleanupSuccessMessage, setCleanupSuccessMessage] = useState<string | null>(null);
	const [sortColumn, setSortColumn] = useState<TaskSortColumn>("id");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
	const priorityOptions = useMemo(
		() => [{ label: "All priorities", value: "" }, ...getPriorityOptions(priorityOrder)],
		[priorityOrder],
	);
	const tableHeaderScrollRef = useRef<HTMLDivElement | null>(null);
	const tableBodyScrollRef = useRef<HTMLDivElement | null>(null);
	const isSyncingTableScrollRef = useRef(false);
	const isFilteringTerminalStatus = statusFilter.some((status) => isTerminalStatus(status, statusOptions));
	const milestoneAliasToCanonical = useMemo(() => {
		const aliasMap = new Map<string, string>();
		const collectIdAliasKeys = (value: string): string[] => {
			const normalized = value.trim();
			const normalizedKey = normalized.toLowerCase();
			if (!normalizedKey) return [];
			const keys = new Set<string>([normalizedKey]);
			if (/^\d+$/.test(normalized)) {
				const numericAlias = String(Number.parseInt(normalized, 10));
				keys.add(numericAlias);
				keys.add(`m-${numericAlias}`);
				return Array.from(keys);
			}
			const idMatch = normalized.match(/^m-(\d+)$/i);
			if (idMatch?.[1]) {
				const numericAlias = String(Number.parseInt(idMatch[1], 10));
				keys.add(`m-${numericAlias}`);
				keys.add(numericAlias);
			}
			return Array.from(keys);
		};
		const reservedIdKeys = new Set<string>();
		for (const milestone of [...(milestoneEntities ?? []), ...(archivedMilestones ?? [])]) {
			for (const key of collectIdAliasKeys(milestone.id)) {
				reservedIdKeys.add(key);
			}
		}
		const setAlias = (aliasKey: string, id: string, allowOverwrite: boolean) => {
			const existing = aliasMap.get(aliasKey);
			if (!existing) {
				aliasMap.set(aliasKey, id);
				return;
			}
			if (!allowOverwrite) {
				return;
			}
			const existingKey = existing.toLowerCase();
			const nextKey = id.toLowerCase();
			const preferredRawId = /^\d+$/.test(aliasKey) ? `m-${aliasKey}` : /^m-\d+$/.test(aliasKey) ? aliasKey : null;
			if (preferredRawId) {
				const existingIsPreferred = existingKey === preferredRawId;
				const nextIsPreferred = nextKey === preferredRawId;
				if (existingIsPreferred && !nextIsPreferred) {
					return;
				}
				if (nextIsPreferred && !existingIsPreferred) {
					aliasMap.set(aliasKey, id);
				}
				return;
			}
			aliasMap.set(aliasKey, id);
		};
		const addIdAliases = (id: string, allowOverwrite = true) => {
			const idKey = id.toLowerCase();
			setAlias(idKey, id, allowOverwrite);
			const idMatch = id.match(/^m-(\d+)$/i);
			if (!idMatch?.[1]) return;
			const numericAlias = String(Number.parseInt(idMatch[1], 10));
			const canonicalId = `m-${numericAlias}`;
			setAlias(canonicalId, id, allowOverwrite);
			setAlias(numericAlias, id, allowOverwrite);
		};
		const activeTitleCounts = new Map<string, number>();
		for (const milestone of milestoneEntities ?? []) {
			const title = milestone.title.trim();
			if (!title) continue;
			const titleKey = title.toLowerCase();
			activeTitleCounts.set(titleKey, (activeTitleCounts.get(titleKey) ?? 0) + 1);
		};
		const activeTitleKeys = new Set(activeTitleCounts.keys());
		for (const milestone of milestoneEntities ?? []) {
			const id = milestone.id.trim();
			const title = milestone.title.trim();
			if (!id) continue;
			addIdAliases(id, true);
			if (title && !reservedIdKeys.has(title.toLowerCase()) && activeTitleCounts.get(title.toLowerCase()) === 1) {
				const titleKey = title.toLowerCase();
				if (!aliasMap.has(titleKey)) {
					aliasMap.set(titleKey, id);
				}
			}
		}
		const archivedTitleCounts = new Map<string, number>();
		for (const milestone of archivedMilestones ?? []) {
			const title = milestone.title.trim();
			if (!title) continue;
			const titleKey = title.toLowerCase();
			if (activeTitleKeys.has(titleKey)) continue;
			archivedTitleCounts.set(titleKey, (archivedTitleCounts.get(titleKey) ?? 0) + 1);
		}
		for (const milestone of archivedMilestones ?? []) {
			const id = milestone.id.trim();
			const title = milestone.title.trim();
			if (!id) continue;
			addIdAliases(id, false);
			const titleKey = title.toLowerCase();
			if (
				title &&
				!activeTitleKeys.has(titleKey) &&
				!reservedIdKeys.has(titleKey) &&
				archivedTitleCounts.get(titleKey) === 1
			) {
				if (!aliasMap.has(titleKey)) {
					aliasMap.set(titleKey, id);
				}
			}
		}
		return aliasMap;
	}, [milestoneEntities, archivedMilestones]);
	const archivedMilestoneKeys = useMemo(
		() => new Set(collectArchivedMilestoneKeys(archivedMilestones, milestoneEntities).map((value) => milestoneKey(value))),
		[archivedMilestones, milestoneEntities],
	);
	const canonicalizeMilestone = (value?: string | null): string => {
		const normalized = (value ?? "").trim();
		if (!normalized) return "";
		const key = normalized.toLowerCase();
		const direct = milestoneAliasToCanonical.get(key);
		if (direct) {
			return direct;
		}
		const idMatch = normalized.match(/^m-(\d+)$/i);
		if (idMatch?.[1]) {
			const numericAlias = String(Number.parseInt(idMatch[1], 10));
			return milestoneAliasToCanonical.get(`m-${numericAlias}`) ?? milestoneAliasToCanonical.get(numericAlias) ?? normalized;
		}
		if (/^\d+$/.test(normalized)) {
			const numericAlias = String(Number.parseInt(normalized, 10));
			return milestoneAliasToCanonical.get(`m-${numericAlias}`) ?? milestoneAliasToCanonical.get(numericAlias) ?? normalized;
		}
		return normalized;
	};

	const sortedBaseTasks = useMemo(() => sortTasksByIdDescending(tasks), [tasks]);
	const mergedAvailableLabels = useMemo(
		() => collectAvailableLabels(tasks, availableLabels),
		[tasks, availableLabels],
	);
	const milestoneOptions = useMemo(() => {
		const uniqueMilestones = Array.from(new Set([...availableMilestones.map((m) => m.trim()).filter(Boolean)]));
		return uniqueMilestones;
	}, [availableMilestones]);
	const customFilters = Object.fromEntries(customFilterKeys.map((key) => {
		const raw = searchParams.get(key);
		const definition = schema.fields[key];
		if (!raw) return [key, null];
		if (definition?.type === "multi-enum" || definition?.type === "string-list" || definition?.type === "user-list") return [key, raw.split(",").map((value) => value.trim()).filter(Boolean)];
		if (definition?.type === "enum") return [key, definition.values?.find((value) => value.toLowerCase() === raw.toLowerCase()) ?? null];
		if (definition?.type === "number") return [key, Number(raw)];
		if (definition?.type === "bool") return [key, raw === "true" ? true : raw === "false" ? false : null];
		return [key, raw];
	})) as Record<string, RegistryFieldValue | null>;
	const overdueEnabled = Object.values(schema.fields).some((field) => field.type === "date" && field.overdue_when !== undefined);
	const overdueOnly = overdueEnabled && searchParams.get("overdue") === "1";
	const hasActiveFilters = Boolean(
		statusFilter.length > 0 ||
			overdueOnly ||
			excludedStatusFilter.length > 0 ||
			priorityFilter ||
			labelFilter.length > 0 ||
			milestoneFilter || Object.values(customFilters).some((value) => value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)),
	);
	const totalTasks = sortedBaseTasks.length;

	useEffect(() => {
		const paramStatuses = normalizeStatusFilters(getStatusFilters(searchParams), statusOptions);
		const paramExcludedStatuses = [...searchParams.getAll("excludeStatus")];
		const excludedStatusesCsv = searchParams.get("excludeStatuses");
		if (excludedStatusesCsv) {
			paramExcludedStatuses.push(...excludedStatusesCsv.split(","));
		}
		const normalizedExcludedStatuses = paramExcludedStatuses
			.map((status) => status.trim())
			.filter((status) => status.length > 0);
		const rawParamPriority = searchParams.get("priority") ?? "";
		const paramPriority = resolvePriorityValue(rawParamPriority, priorityOrder) ?? "";
		const paramMilestone = searchParams.get("milestone") ?? "";
		const paramLabels = [...searchParams.getAll("label"), ...searchParams.getAll("labels")];
		const labelsCsv = searchParams.get("labels");
		if (labelsCsv) {
			paramLabels.push(...labelsCsv.split(","));
		}
		const normalizedLabels = paramLabels.map((label) => label.trim()).filter((label) => label.length > 0);

		if (!areEqualStringArrays(paramStatuses, statusFilter)) {
			setStatusFilter(paramStatuses);
		}
		if (!areEqualStringArrays(normalizedExcludedStatuses, excludedStatusFilter)) {
			setExcludedStatusFilter(normalizedExcludedStatuses);
		}
		if (!isLoading && rawParamPriority !== paramPriority) {
			setSearchParams(
				(params) => {
					if (paramPriority) {
						params.set("priority", paramPriority);
					} else {
						params.delete("priority");
					}
					return params;
				},
				{ replace: true },
			);
		}
		if (!isLoading && paramPriority !== priorityFilter) {
			setPriorityFilter(paramPriority);
		}
		if (paramMilestone !== milestoneFilter) {
			setMilestoneFilter(paramMilestone);
		}
		if (!areEqualStringArrays(normalizedLabels, labelFilter)) {
			setLabelFilter(normalizedLabels);
		}
	}, [isLoading, priorityOrder, searchParams, setSearchParams, statusOptions]);
	useEffect(() => {
		if (isLoading) return;
		const corrections = customFilterKeys.flatMap((key) => {
			const field = schema.fields[key];
			if (field?.type !== "enum") return [];
			const raw = searchParams.get(key);
			if (!raw) return [];
			const canonical = field.values?.find((value) => value.toLowerCase() === raw.toLowerCase());
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
	}, [isLoading, schema, searchParams, setSearchParams]);

	useEffect(() => {
		if (!hasActiveFilters) {
			setDisplayTasks(sortedBaseTasks);
			setError(null);
		}
	}, [hasActiveFilters, sortedBaseTasks]);

	useEffect(() => {
		const filterByMilestone = (list: Task[]): Task[] => {
			const normalized = canonicalizeMilestone(milestoneFilter);
			if (!normalized) return list;
			return list.filter((task) => {
				const canonicalTaskMilestone = canonicalizeMilestone(task.milestone);
				const taskKey = milestoneKey(canonicalTaskMilestone);
				const normalizedTaskMilestone = taskKey && archivedMilestoneKeys.has(taskKey) ? "" : canonicalTaskMilestone;
				if (normalized === "__none") {
					return !normalizedTaskMilestone;
				}
				return normalizedTaskMilestone === normalized;
			});
		};

		const shouldUseApi =
			statusFilter.length > 0 ||
			excludedStatusFilter.length > 0 ||
			Boolean(priorityFilter) ||
			labelFilter.length > 0;

		if (!hasActiveFilters) {
			return;
		}

		let cancelled = false;
		setError(null);

		const fetchFilteredTasks = async () => {
			// If only milestone filter is active, filter locally to avoid an extra request
			if (!shouldUseApi) {
				setDisplayTasks(filterByMilestone(sortedBaseTasks));
				return;
			}
			try {
				const results = await apiClient.search({
					types: ["task"],
					status: statusFilter.length > 0 ? statusFilter : undefined,
					excludeStatus: excludedStatusFilter.length > 0 ? excludedStatusFilter : undefined,
					priority: priorityFilter || undefined,
					labels: labelFilter.length > 0 ? labelFilter : undefined,
				});
				if (cancelled) {
					return;
				}
				const taskResults = results.filter((result): result is TaskSearchResult => result.type === "task");
				const filtered = filterByMilestone(taskResults.map((result) => result.task));
				setDisplayTasks(sortTasksByIdDescending(filtered));
			} catch (err) {
				console.error("Failed to apply task filters:", err);
				if (!cancelled) {
					setDisplayTasks([]);
					setError("Unable to fetch tasks for the selected filters.");
				}
			}
		};

		fetchFilteredTasks();

		return () => {
			cancelled = true;
		};
	}, [
		hasActiveFilters,
		excludedStatusFilter,
		priorityFilter,
		statusFilter,
		labelFilter,
		tasks,
		milestoneFilter,
		sortedBaseTasks,
		milestoneAliasToCanonical,
		archivedMilestoneKeys,
	]);

	const syncUrl = (
		nextStatuses: string[],
		nextExcludedStatuses: string[],
		nextPriority: string,
		nextLabels: string[],
		nextMilestone: string,
	) => {
		const params = new URLSearchParams(searchParams);
		for (const key of ["status", "excludeStatus", "excludeStatuses", "priority", "label", "labels", "milestone"]) params.delete(key);
		for (const status of nextStatuses) {
			if (status.trim()) {
				params.append("status", status.trim());
			}
		}
		for (const status of nextExcludedStatuses) {
			if (status.trim()) {
				params.append("excludeStatus", status.trim());
			}
		}
		if (nextPriority) {
			params.set("priority", nextPriority);
		}
		if (nextLabels.length > 0) {
			for (const label of nextLabels) {
				params.append("label", label);
			}
		}
		if (nextMilestone) {
			params.set("milestone", nextMilestone);
		}
		setSearchParams(params, { replace: true });
	};

	const handleStatusChange = (next: string[]) => {
		const normalized = normalizeStatusFilters(next, statusOptions);
		setStatusFilter(normalized);
		syncUrl(normalized, excludedStatusFilter, priorityFilter, labelFilter, milestoneFilter);
	};

	const handleExcludeStatusChange = (next: string[]) => {
		const normalized = next.map((status) => status.trim()).filter((status) => status.length > 0);
		setExcludedStatusFilter(normalized);
		syncUrl(statusFilter, normalized, priorityFilter, labelFilter, milestoneFilter);
	};

	const handlePriorityChange = (value: string) => {
		setPriorityFilter(value);
		syncUrl(statusFilter, excludedStatusFilter, value, labelFilter, milestoneFilter);
	};

	const handleLabelChange = (next: string[]) => {
		const normalized = next.map((label) => label.trim()).filter((label) => label.length > 0);
		setLabelFilter(normalized);
		syncUrl(statusFilter, excludedStatusFilter, priorityFilter, normalized, milestoneFilter);
	};

	const handleMilestoneChange = (value: string) => {
		setMilestoneFilter(value);
		syncUrl(statusFilter, excludedStatusFilter, priorityFilter, labelFilter, value);
	};

	const handleClearFilters = () => {
		setStatusFilter([]);
		setExcludedStatusFilter([]);
		setPriorityFilter("");
		setLabelFilter([]);
		setMilestoneFilter("");
		setSearchParams((params) => {
			for (const key of [...filterKeys, "excludeStatus", "excludeStatuses", "label", "labels", "overdue"]) params.delete(key);
			return params;
		}, { replace: true });
		setDisplayTasks(sortedBaseTasks);
		setError(null);
	};
	const handleCustomFilterChange = (key: string, value: RegistryFieldValue | null) => {
		setSearchParams((params) => {
			params.delete(key);
			if (value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)) params.set(key, Array.isArray(value) ? value.join(",") : String(value));
			return params;
		}, { replace: true });
	};

	const handleCleanupSuccess = async (message: string) => {
		setShowCleanupModal(false);
		setCleanupSuccessMessage(message);

		// Refresh the data - existing effects will handle re-filtering automatically
		if (onRefreshData) {
			await onRefreshData();
		}

		// Auto-dismiss success message after 4 seconds
		setTimeout(() => {
			setCleanupSuccessMessage(null);
		}, 4000);
	};

	const getStatusColor = (status: string) => {
		switch (status.toLowerCase()) {
			case "to do":
				return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
			case "in progress":
				return "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200";
			case "done":
				return "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200";
			default:
				return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
		}
	};

	const getPriorityColor = (priority?: string) => {
		switch (priority?.toLowerCase()) {
			case "high":
				return "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200";
			case "medium":
				return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200";
			case "low":
				return "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200";
			default:
				return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
		}
	};

	const handleSortChange = (column: TaskSortColumn) => {
		if (sortColumn === column) {
			setSortDirection((previous) => (previous === "asc" ? "desc" : "asc"));
			return;
		}

		setSortColumn(column);
		setSortDirection(column === "id" || column === "created" ? "desc" : "asc");
	};

	const getSortAriaValue = (column: TaskSortColumn): "none" | "ascending" | "descending" => {
		if (sortColumn !== column) return "none";
		return sortDirection === "asc" ? "ascending" : "descending";
	};

	const renderSortIcon = (column: TaskSortColumn) => {
		const isActive = sortColumn === column;
		if (!isActive) {
			return (
				<span className="text-[10px] text-gray-300 dark:text-gray-600 select-none" aria-hidden="true">
					↕
				</span>
			);
		}
		return (
			<span className="text-[10px] text-gray-600 dark:text-gray-300 select-none" aria-hidden="true">
				{sortDirection === "asc" ? "▲" : "▼"}
			</span>
		);
	};

	const renderSortableHeader = (label: string, column: TaskSortColumn) => (
		<th key={column} className="px-3 py-2" aria-sort={getSortAriaValue(column)}>
			<button
				type="button"
				onClick={() => handleSortChange(column)}
				className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-100"
			>
				{label}
				{renderSortIcon(column)}
			</button>
		</th>
	);

	const renderColumnGroup = () => (
		<colgroup>
			{columnWidths.map((width, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the column order follows the schema
				<col key={index} style={width === null ? undefined : { width: `${width}rem` }} />
			))}
		</colgroup>
	);

	const sortedDisplayTasks = useMemo(() => {
		return [...displayTasks].sort((a, b) => {
			if (sortColumn === "id") return sortDirection === "asc" ? compareTaskIds(a.id, b.id) : compareTaskIdsDescending(a.id, b.id);
			const left = fieldValue(a, sortColumn);
			const right = fieldValue(b, sortColumn);
			if (sortColumn === "ordinal" && (left === undefined || right === undefined)) {
				if (left !== right) return left === undefined ? 1 : -1;
			}
			const result = registry.compare(sortColumn, left, right, sortColumn === "priority" ? priorityOrder : undefined);
			if (result !== 0) return sortDirection === "asc" ? result : -result;
			if (sortColumn === "ordinal") return compareTaskIdsAscending(a, b);
			return compareTaskIdsDescending(a.id, b.id);
		});
	}, [displayTasks, priorityOrder, registry, sortColumn, sortDirection]);
	const renderFieldCell = (task: Task, key: string) => {
		const value = fieldValue(task, key);
		if (key === "status") return <td key={key} className="px-3 py-2.5"><span className={`inline-flex rounded-circle px-2 py-0.5 text-[11px] font-medium ${getStatusColor(String(value ?? ""))}`}>{value}</span></td>;
		if (key === "priority") return <td key={key} className="px-3 py-2.5">{value ? <span className={`inline-flex rounded-circle px-2 py-0.5 text-[11px] font-medium ${getPriorityColor(String(value))}`}>{formatPriorityLabel(String(value), priorityOrder)}</span> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}</td>;
		if (key === "ordinal") return <td key={key} className="px-3 py-2.5 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">{value ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>;
		if (key === "labels" && Array.isArray(value)) return <td key={key} className="px-3 py-2.5">{value.length ? <div className="flex items-center gap-1 min-w-0">{value.slice(0, 2).map((label) => <span key={label} className="inline-flex max-w-[7rem] truncate rounded-circle bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-200" title={label}>{label}</span>)}{value.length > 2 && <span className="text-[11px] text-gray-500 dark:text-gray-400">+{value.length - 2}</span>}</div> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}</td>;
		if (key === "assignee" && Array.isArray(value)) return <td key={key} className="px-3 py-2.5">{value.length ? <div className="flex items-center gap-1.5">{value.slice(0, 2).map((assignee) => <span key={assignee} title={assignee} className="inline-flex h-6 w-6 items-center justify-center rounded-circle bg-blue-100 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">{getAssigneeInitials(assignee)}</span>)}{value.length > 2 && <span className="text-[11px] text-gray-500 dark:text-gray-400">+{value.length - 2}</span>}</div> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}</td>;
		if (key === "milestone") {
			const label = value ? getMilestoneLabel(String(value), milestoneEntities) : "—";
			return <td key={key} className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-300 truncate" title={label}>{label}</td>;
		}
		return <td key={key} className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap"><FieldValue fieldKey={key} value={value} variant="cell" dateFormat={dateFormat} overdue={task.overdue?.includes(key)} /></td>;
	};
	const visibleTasks = sortedDisplayTasks.filter((task) => (!overdueOnly || (task.overdue?.length ?? 0) > 0) && customFilterKeys.every((key) => {
		const wanted = customFilters[key];
		if (wanted === null || wanted === undefined || wanted === "" || (Array.isArray(wanted) && !wanted.length)) return true;
		const actual = fieldValue(task, key);
		if (wanted === "__unassigned__") return !Array.isArray(actual) || actual.length === 0;
		if (Array.isArray(wanted)) return Array.isArray(actual) && wanted.some((item) => actual.some((entry) => entry.toLowerCase() === item.toLowerCase()));
		if (Array.isArray(actual)) return actual.some((item) => item.toLowerCase() === String(wanted).toLowerCase());
		return String(actual ?? "").toLowerCase() === String(wanted).toLowerCase();
	}));

	const currentCount = visibleTasks.length;
	// Share a slot sized for the largest visible count. Keep the existing 3rem through 99/99;
	// each extra digit needs space in both checked and total, using the counter's tabular font.
	const progressSlotDigits = visibleTasks.reduce((digits, task) => {
		const progress = getAcceptanceCriteriaProgressCounts(task);
		return progress ? Math.max(digits, String(progress.total).length) : digits;
	}, 0);
	const progressSlotWidth = `calc(3rem + ${Math.max(0, progressSlotDigits - 2) * 2}ch)`;

	useEffect(() => {
		const headerEl = tableHeaderScrollRef.current;
		const bodyEl = tableBodyScrollRef.current;
		if (!headerEl || !bodyEl) return;

		const syncScrollLeft = (source: HTMLDivElement, target: HTMLDivElement) => {
			if (isSyncingTableScrollRef.current) return;
			isSyncingTableScrollRef.current = true;
			target.scrollLeft = source.scrollLeft;
			isSyncingTableScrollRef.current = false;
		};

		const handleHeaderScroll = () => syncScrollLeft(headerEl, bodyEl);
		const handleBodyScroll = () => syncScrollLeft(bodyEl, headerEl);

		headerEl.addEventListener("scroll", handleHeaderScroll, { passive: true });
		bodyEl.addEventListener("scroll", handleBodyScroll, { passive: true });
		headerEl.scrollLeft = bodyEl.scrollLeft;

		return () => {
			headerEl.removeEventListener("scroll", handleHeaderScroll);
			bodyEl.removeEventListener("scroll", handleBodyScroll);
		};
	}, [currentCount]);
	const renderSchemaFilter = (key: string) => {
		if (key === "status") return <React.Fragment key={key}>
			<LabelFilterDropdown availableLabels={statusOptions} selectedLabels={statusFilter} onChange={handleStatusChange} menuId="task-list-status-menu" label="Status" emptyLabel="All" noOptionsLabel="No statuses" clearLabel="Clear status filter" className="min-w-[180px]" />
			<LabelFilterDropdown availableLabels={statusOptions} selectedLabels={excludedStatusFilter} onChange={handleExcludeStatusChange} menuId="task-list-exclude-status-menu" label="Exclude status" emptyLabel="None" noOptionsLabel="No statuses" clearLabel="Clear excluded statuses" className="min-w-[210px]" />
		</React.Fragment>;
		if (key === "priority") return <select key={key} aria-label="Filter by priority" value={priorityFilter} onChange={(event) => handlePriorityChange(event.target.value)} className="min-w-[120px] h-10 py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200">{priorityOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}</select>;
		if (key === "milestone") return <select key={key} aria-label="Filter by milestone" value={milestoneFilter} onChange={(event) => handleMilestoneChange(event.target.value)} className="min-w-[160px] h-10 py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:focus:ring-stone-400 transition-colors duration-200"><option value="">All milestones</option><option value="__none">No milestone</option>{milestoneOptions.map((milestone) => <option key={milestone} value={milestone}>{getMilestoneLabel(milestone, milestoneEntities)}</option>)}</select>;
		if (key === "labels") return <LabelFilterDropdown key={key} availableLabels={mergedAvailableLabels} selectedLabels={labelFilter} onChange={handleLabelChange} menuId="task-list-labels-menu" />;
		return <FieldFilter key={key} fieldKey={key} value={customFilters[key]} onChange={(value) => handleCustomFilterChange(key, value)} />;
	};

	return (
		<div className="page-shell transition-colors duration-200">
			<div className="flex flex-col gap-4 mb-6">
				<div className="flex items-center justify-between gap-3">
						<h1 className="text-2xl font-bold text-gray-900 dark:text-white">All Tasks</h1>
						<button
							className="inline-flex items-center px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400 dark:focus:ring-offset-gray-900 transition-colors duration-200"
							onClick={onNewTask}
						>
							+ New Task
					</button>
				</div>

				<div className="flex flex-wrap items-center gap-3 justify-between">
					<div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
						{filterKeys.map(renderSchemaFilter)}
						{overdueEnabled && <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap"><input type="checkbox" checked={overdueOnly} onChange={(event) => setSearchParams((params) => { if (event.target.checked) params.set("overdue", "1"); else params.delete("overdue"); return params; }, { replace: true })} />Overdue</label>}
					</div>
					<div className="flex items-center gap-3 flex-shrink-0">
						{isFilteringTerminalStatus && currentCount > 0 && <button type="button" onClick={() => setShowCleanupModal(true)} className="py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 flex items-center gap-2 whitespace-nowrap" title="Clean up old completed tasks"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>Clean Up</button>}
						{hasActiveFilters && <button type="button" onClick={handleClearFilters} className="py-2 px-3 text-sm border border-gray-300 dark:border-gray-600 rounded-lg whitespace-nowrap transition-colors duration-200 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700">Clear filters</button>}
						<div className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap text-right min-w-[170px]">Showing {currentCount} of {totalTasks} tasks</div>
					</div>
				</div>

				{error && (
					<div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
						{error}
					</div>
				)}
			</div>

			{currentCount === 0 ? (
				<div className="text-center py-12">
					<svg className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
					</svg>
					<h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
						{hasActiveFilters ? "No tasks match the current filters" : "No tasks"}
					</h3>
					<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
						{hasActiveFilters
							? "Try adjusting your search or clearing filters to see more tasks."
							: "Get started by creating a new task."}
					</p>
				</div>
			) : (
				<div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
					<div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/90 supports-[backdrop-filter]:dark:bg-gray-700/85">
						<div ref={tableHeaderScrollRef} className="overflow-x-auto" style={{ overflowY: "hidden" }}>
							<table className="w-full table-fixed border-collapse" style={{ minWidth: `${tableMinWidth}rem` }}>
								{renderColumnGroup()}
								<thead>
									<tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">
										{renderSortableHeader("ID", "id")}
										{renderSortableHeader("Title", "title")}
										{columnKeys.map((key) => renderSortableHeader(schema.fields[key]?.label ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`, key))}
									</tr>
								</thead>
							</table>
						</div>
					</div>
					<div ref={tableBodyScrollRef} className="overflow-x-auto" style={{ overflowY: "hidden" }}>
						<table className="w-full table-fixed border-collapse" style={{ minWidth: `${tableMinWidth}rem` }}>
							{renderColumnGroup()}
							<tbody className="divide-y divide-gray-200 dark:divide-gray-700">
								{visibleTasks.map((task) => {
									const isFromOtherBranch = Boolean(task.branch);

									return (
										<tr
											key={task.id}
											onClick={() => onEditTask(task)}
											className={`cursor-pointer transition-colors ${
												isFromOtherBranch
													? "bg-amber-50/50 hover:bg-amber-100/70 dark:bg-amber-900/10 dark:hover:bg-amber-900/20"
													: "bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/50"
											}`}
										>
											<td className="px-3 py-2.5 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-nowrap">
												{task.id}
											</td>
											<td className="px-3 py-2.5">
												<div className="flex items-center gap-2 min-w-0">
													{progressSlotDigits > 0 && (
														<span className="flex min-w-12 shrink-0 text-[10px] font-medium tabular-nums" style={{ width: progressSlotWidth }}>
															<AcceptanceCriteriaProgress task={task} density="list" />
														</span>
													)}
													<button
														type="button"
														onClick={(event) => {
															event.stopPropagation();
															onEditTask(task);
														}}
														className={`block truncate text-sm ${
															isFromOtherBranch
																? "text-gray-600 dark:text-gray-300"
																: "text-gray-900 dark:text-gray-100"
														} rounded text-left focus:outline-none focus:ring-2 focus:ring-stone-500`}
														title={task.title}
														aria-label={`Open ${task.id}: ${task.title}`}
													>
														{task.title}
													</button>
													{isFromOtherBranch && task.branch && (
														<span
															className="inline-flex shrink-0 items-center rounded-circle bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
															title={`Read-only task from ${task.branch} branch`}
														>
															{task.branch}
														</span>
													)}
												</div>
												{task.dueDate && (
													<div className="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
														Due: <StoredDate value={task.dueDate} dateFormat={dateFormat} />
													</div>
												)}
											</td>
											{columnKeys.map((key) => renderFieldCell(task, key))}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{/* Cleanup Modal */}
			<CleanupModal
				isOpen={showCleanupModal}
				onClose={() => setShowCleanupModal(false)}
				onSuccess={handleCleanupSuccess}
				dateFormat={dateFormat}
			/>

			{/* Cleanup Success Toast */}
			{cleanupSuccessMessage && (
				<SuccessToast
					message={cleanupSuccessMessage}
					onDismiss={() => setCleanupSuccessMessage(null)}
					icon={
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					}
				/>
			)}
		</div>
	);
};

export default TaskList;
