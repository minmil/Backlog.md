import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isReadOnlyTask, type AcceptanceCriterion, type Milestone, type Task, type TaskComment } from "../../types";
import { type TaskDetail, taskDependencyGraph, taskReadiness } from "../../core/task-detail";
import Modal from "./Modal";
import { apiClient, ApiError, NetworkError, readDemotionFailureCause, readMovedFailureState } from "../lib/api";
import type { FieldValue as RegistryFieldValue } from "../../schema/field-registry.ts";
import type { SectionValue } from "../../markdown/sections.ts";
import { useSchema } from "./schema/SchemaProvider.tsx";
import SchemaSidebar from "./schema/SchemaSidebar.tsx";
import { useTheme } from "../contexts/ThemeContext";
import MDEditor from "@uiw/react-md-editor";
import AcceptanceCriteriaEditor from "./AcceptanceCriteriaEditor";
import MermaidMarkdown from './MermaidMarkdown';
import { DependencyGraphSection } from "./DependencyGraphSection";
import StoredDate from "./StoredDate";
import { formatReadinessBlockers } from "../../utils/readiness";
import { findDirectSubtasks, findParentTask, summarizeSubtaskProgress } from "../../utils/task-subtasks.ts";
import { isTerminalStatus } from "../../utils/terminal-status.ts";
import { createUrlPath } from "../utils/urlHelpers";

interface Props {
  task?: Task | TaskDetail; // Optional for create mode
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => Promise<void> | void; // refresh callback
  onSubmit?: (taskData: Partial<Task>) => Promise<void>; // For creating new tasks
  onArchive?: () => Promise<void> | void; // For archiving tasks
  onDependencyCleanup?: (taskId: string, cleanedTaskIds: string[]) => void; // Reports records that lost a reference
  availableStatuses?: string[]; // Available statuses for new tasks
  availableTasks?: Task[]; // Shared task corpus for dependency selection
  onNavigateToTask?: (task: Task) => void; // Opens another task, preserving close/back context
  isDraftMode?: boolean; // Whether creating a draft
  availableMilestones?: string[];
  availablePriorities?: string[];
  availableTypes?: string[];
  availableProjects?: string[];
  milestoneEntities?: Milestone[];
  archivedMilestoneEntities?: Milestone[];
  definitionOfDoneDefaults?: string[];
  defaultAssignee?: string[];
  dateFormat?: string;
}

type Mode = "preview" | "edit" | "create";

type TaskUpdatePayload = Omit<Partial<Task>, "dueDate" | "project"> & {
	dueDate?: string | null;
  project?: string | null;
  definitionOfDoneAdd?: string[];
  definitionOfDoneRemove?: number[];
  definitionOfDoneCheck?: number[];
  definitionOfDoneUncheck?: number[];
  disableDefinitionOfDoneDefaults?: boolean;
  commentsAppend?: string[];
  commentAuthor?: string;
};

type InlineMetaUpdatePayload = Omit<Partial<Task>, "milestone"> & {
  milestone?: string | null;
};

type TaskDetailsFormState = {
  title: string;
  description: string;
  plan: string;
  notes: string;
  displayComments: TaskComment[];
  finalSummary: string;
  criteria: AcceptanceCriterion[];
  definitionOfDone: AcceptanceCriterion[];
  status: string;
  assignee: string[];
  labels: string[];
  priority: string;
  taskType: string;
  project: string;
  dependencies: string[];
  references: string[];
  modifiedFiles: string[];
  milestone: string;
  dueDate: string;
};

// Shared empty defaults. A `= []` default parameter allocates a fresh array on every render, so
// every memo and effect keyed on it re-runs each time; combined with a state update in that chain
// the modal spins until React aborts with "Maximum update depth exceeded".
const EMPTY_STATUSES: string[] = [];
const EMPTY_TASKS: Task[] = [];

const containsCommentDelimiterLine = (value: string): boolean => /^\s*---\s*$/m.test(value.replace(/\r\n/g, "\n"));

const areJsonEqual = (first: unknown, second: unknown): boolean => JSON.stringify(first) === JSON.stringify(second);

type SchemaTask = Task & {
  fields?: Record<string, RegistryFieldValue>;
  sections?: Record<string, SectionValue>;
  other?: string;
};

function readSchemaFieldValues(
  task: Task | TaskDetail | undefined,
  registry: ReturnType<typeof useSchema>["registry"],
  isDraftMode: boolean | undefined,
): Record<string, RegistryFieldValue | null> {
  const values: Record<string, RegistryFieldValue | null> = {};
  const supplied = (task as SchemaTask | undefined)?.fields;
  for (const [key, definition] of Object.entries(registry.schema.fields)) {
    const stored = supplied?.[key] ?? (task ? registry.getField(task, key) : undefined);
    if (stored !== undefined) values[key] = stored;
    else if (!task && definition.default !== undefined) values[key] = definition.default as RegistryFieldValue;
  }
  if (!task) {
    const defaultUser = registry.schema.users.find((user) => user.default)?.handle;
    if (defaultUser && values.assignee === undefined) values.assignee = [defaultUser];
    if (defaultUser && values.reporter === undefined) values.reporter = defaultUser;
    if (isDraftMode) values.status = "Draft";
  }
  return values;
}

const isEditableKeyboardTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;

const preserveDirtyRefreshValue = <T,>(
  current: T,
  previous: T,
  next: T,
  isEqual: (first: T, second: T) => boolean = Object.is,
): T => (isEqual(current, previous) ? next : current);

const buildTaskDetailsFormState = ({
  task,
  isCreateMode,
  isDraftMode,
  availableStatuses,
  defaultDefinitionOfDone,
  createModeAssignee,
}: {
  task?: Task | TaskDetail;
  isCreateMode: boolean;
  isDraftMode?: boolean;
  availableStatuses?: string[];
  defaultDefinitionOfDone: AcceptanceCriterion[];
  createModeAssignee: string[];
}): TaskDetailsFormState => ({
  title: task?.title || "",
  description: task?.description || "",
  plan: task?.implementationPlan || "",
  notes: task?.implementationNotes || "",
  displayComments: task?.comments ?? [],
  finalSummary: task?.finalSummary || "",
  criteria: task?.acceptanceCriteriaItems || [],
  definitionOfDone: task?.definitionOfDoneItems || (isCreateMode ? defaultDefinitionOfDone : []),
  status: isDraftMode ? "Draft" : (task?.status || (availableStatuses?.[0] || "To Do")),
  assignee: task?.assignee || createModeAssignee,
  labels: task?.labels || [],
  priority: task?.priority || "",
  taskType: task?.type || "",
  project: task?.project || "",
  dependencies: task?.dependencies || [],
  references: task?.references || [],
  modifiedFiles: task?.modifiedFiles || [],
  milestone: task?.milestone || "",
  dueDate: task?.dueDate || "",
});

const SectionHeader: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight transition-colors duration-200">
      {title}
    </h3>
    {right ? <div className="ml-2 text-xs text-gray-500 dark:text-gray-400">{right}</div> : null}
  </div>
);

const HierarchyStatusBadge: React.FC<{ status: string; statuses: string[] }> = ({ status, statuses }) => {
  const normalized = (status ?? '').toLowerCase();
  const tone = isTerminalStatus(status, statuses)
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : normalized.includes('progress')
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  );
};

const HierarchyChevron: React.FC = () => (
  <svg
    className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-gray-500"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export const TaskDetailsModal: React.FC<Props> = ({
  task,
  isOpen,
  onClose,
  onSaved,
  onSubmit,
  onArchive,
  onDependencyCleanup,
  availableStatuses = EMPTY_STATUSES,
  availableTasks = EMPTY_TASKS,
  onNavigateToTask,
  milestoneEntities,
  isDraftMode,
  definitionOfDoneDefaults,
  defaultAssignee,
  dateFormat,
}) => {
  const { theme } = useTheme();
  const { schema, registry } = useSchema();
  const isCreateMode = !task;
  const schemaFieldBaseline = useMemo(() => readSchemaFieldValues(task, registry, isDraftMode), [task, registry, isDraftMode]);
  const [schemaFields, setSchemaFields] = useState<Record<string, RegistryFieldValue | null>>(schemaFieldBaseline);
  const schemaFieldBaselineRef = useRef(schemaFieldBaseline);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A task from another branch or in the archive is shown but cannot be changed here.
  const isReadOnly = task ? isReadOnlyTask(task) : false;
  // Promoting a draft replaces it with a new task ID, which the Drafts page does through its own
  // Promote action, so the popup shows the draft status without turning the field into a second one.
  const isOpenDraft = (task?.status ?? "").trim().toLowerCase() === "draft";
  const demotionIdentity = [isOpen ? "open" : "closed", task?.id, task?.source, task?.branch, isOpenDraft ? "draft" : "task"].join("\0");
  const demotionIdentityRef = useRef(demotionIdentity);
  demotionIdentityRef.current = demotionIdentity;
  const [mode, setMode] = useState<Mode>(isCreateMode ? "create" : "preview");
  const modeRef = useRef(mode);
  const previousTaskId = useRef(task?.id ?? "");
  const previousIsOpen = useRef(isOpen);
  const formBaselineRef = useRef<TaskDetailsFormState | null>(null);
  const activeDemotionRequest = useRef<{ identity: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [demoting, setDemoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Title field for create mode
  const [title, setTitle] = useState(task?.title || "");

  // Editable fields (edit mode)
  const [description, setDescription] = useState(task?.description || "");
  const [plan, setPlan] = useState(task?.implementationPlan || "");
  const [notes, setNotes] = useState(task?.implementationNotes || "");
  const [displayComments, setDisplayComments] = useState<TaskComment[]>(task?.comments ?? []);
  const [commentBody, setCommentBody] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentsChanged, setCommentsChanged] = useState(false);
  const preserveEditModeAfterCommentRefresh = useRef(false);
  const [finalSummary, setFinalSummary] = useState(task?.finalSummary || "");
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(task?.acceptanceCriteriaItems || []);
  const defaultDefinitionOfDone = useMemo(
    () => (definitionOfDoneDefaults ?? []).map((text, index) => ({ index: index + 1, text, checked: false })),
    [definitionOfDoneDefaults],
  );
  // Create mode starts with the configured defaultAssignee already in the field, as ordinary
  // removable chips, so emptying it says "unassigned" instead of "no opinion".
  const createModeAssignee = useMemo(
    () => (isCreateMode ? (defaultAssignee ?? []) : []),
    [isCreateMode, defaultAssignee],
  );
  const initialDefinitionOfDone = task?.definitionOfDoneItems ?? (isCreateMode ? defaultDefinitionOfDone : []);
  const [definitionOfDone, setDefinitionOfDone] = useState<AcceptanceCriterion[]>(initialDefinitionOfDone);
  // Sidebar metadata (inline edit)
  const [status, setStatus] = useState(isDraftMode ? "Draft" : (task?.status || (availableStatuses?.[0] || "To Do")));
  const [assignee, setAssignee] = useState<string[]>(task?.assignee || createModeAssignee);
  const [labels, setLabels] = useState<string[]>(task?.labels || []);
  const [priority, setPriority] = useState<string>(task?.priority || "");
  const [taskType, setTaskType] = useState<string>(task?.type || "");
  const [project, setProject] = useState<string>(task?.project || "");
  const [dependencies, setDependencies] = useState<string[]>(task?.dependencies || []);
  const [references, setReferences] = useState<string[]>(task?.references || []);
  const [modifiedFiles, setModifiedFiles] = useState<string[]>(task?.modifiedFiles || []);
  const [milestone, setMilestone] = useState<string>(task?.milestone || "");
  const [dueDate, setDueDate] = useState<string>(task?.dueDate || "");

  // Both derived at read time and delivered with the task itself, so there is nothing to resolve
  // or fetch here: the verdict the modal shows is the one every other surface shows.
  const dependencyGraph = taskDependencyGraph(task);
  const readiness = taskReadiness(task);
  // The verdict answers for the status and the dependencies it was read with, and it belongs to the
  // Dependencies card, so it is shown only while all of that still describes what is on screen. An
  // optimistic edit that has not come back yet - including one whose save failed and left the shown
  // status ahead of the record - shows no badge rather than a claim about what it replaced.
  const shownReadiness =
    readiness &&
    (readiness.isReady || readiness.isBlocked) &&
    dependencies.length > 0 &&
    dependencies.join(",") === (task?.dependencies ?? []).join(",") &&
    status === (task?.status ?? "")
      ? readiness
      : null;

  // Hierarchy is derived from the shared corpus rather than the task payload: the single-task
  // API does not carry parent/subtask fields, while the list the modal already receives does.
  const parentTask = useMemo(
    () => (task ? findParentTask(task, availableTasks) : null),
    [task, availableTasks],
  );

  const subtasks = useMemo(
    () => (task ? findDirectSubtasks(task, availableTasks) : []),
    [task, availableTasks],
  );

  const subtaskProgress = useMemo(
    () => (task ? summarizeSubtaskProgress(task, availableTasks, availableStatuses) : null),
    [task, availableTasks, availableStatuses],
  );

  // Keep a baseline for dirty-check
  const baseline = useMemo(() => ({
    title: task?.title || "",
    description: task?.description || "",
    plan: task?.implementationPlan || "",
    notes: task?.implementationNotes || "",
    finalSummary: task?.finalSummary || "",
    dueDate: task?.dueDate || "",
    criteria: JSON.stringify(task?.acceptanceCriteriaItems || []),
    definitionOfDone: JSON.stringify(task?.definitionOfDoneItems || (isCreateMode ? defaultDefinitionOfDone : [])),
  }), [task, defaultDefinitionOfDone, isCreateMode]);

  const isDirty = useMemo(() => {
    return (
      title !== baseline.title ||
      description !== baseline.description ||
      plan !== baseline.plan ||
      notes !== baseline.notes ||
      finalSummary !== baseline.finalSummary ||
      dueDate !== baseline.dueDate ||
      !areJsonEqual(schemaFields, schemaFieldBaseline) ||
      JSON.stringify(criteria) !== baseline.criteria ||
      JSON.stringify(definitionOfDone) !== baseline.definitionOfDone
    );
  }, [title, description, plan, notes, finalSummary, dueDate, criteria, definitionOfDone, baseline, schemaFields, schemaFieldBaseline]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(
    () => () => {
      activeDemotionRequest.current = null;
    },
    [],
  );

  useEffect(() => {
    activeDemotionRequest.current = null;
    setDemoting(false);
  }, [demotionIdentity]);

  // Intercept Escape to cancel edit (not close modal) when in edit mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "edit" && (e.key === "Escape")) {
        e.preventDefault();
        e.stopPropagation();
        handleCancelEdit();
      }
      if (mode === "edit" && ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) {
        e.preventDefault();
        e.stopPropagation();
        void handleSave();
      }
      if (mode !== "preview" || isEditableKeyboardTarget(e.target)) {
        return;
      }
      if (!isReadOnly && e.key.toLowerCase() === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        setMode("edit");
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [mode, title, description, plan, notes, finalSummary, criteria, definitionOfDone, status, availableStatuses, isReadOnly]);

  // Reset local state when task changes or modal opens
  useEffect(() => {
    const nextTaskId = task?.id ?? "";
    const nextFormState = buildTaskDetailsFormState({
      task,
      isCreateMode,
      isDraftMode,
      availableStatuses,
      defaultDefinitionOfDone,
      createModeAssignee,
    });
    const previousFormState = formBaselineRef.current;
    const sameOpenModalRefresh =
      Boolean(previousFormState) && isOpen && previousIsOpen.current && previousTaskId.current === nextTaskId;
    const shouldPreserveEditMode =
      !isCreateMode &&
      sameOpenModalRefresh &&
      (modeRef.current === "edit" || preserveEditModeAfterCommentRefresh.current);

    if (sameOpenModalRefresh && previousFormState) {
      setSchemaFields((current) => preserveDirtyRefreshValue(current, schemaFieldBaselineRef.current, schemaFieldBaseline, areJsonEqual));
      schemaFieldBaselineRef.current = schemaFieldBaseline;
      setTitle((current) => preserveDirtyRefreshValue(current, previousFormState.title, nextFormState.title));
      setDescription((current) =>
        preserveDirtyRefreshValue(current, previousFormState.description, nextFormState.description),
      );
      setPlan((current) => preserveDirtyRefreshValue(current, previousFormState.plan, nextFormState.plan));
      setNotes((current) => preserveDirtyRefreshValue(current, previousFormState.notes, nextFormState.notes));
      setDisplayComments(nextFormState.displayComments);
      setCommentSaving(false);
      setCommentsChanged(false);
      setFinalSummary((current) =>
        preserveDirtyRefreshValue(current, previousFormState.finalSummary, nextFormState.finalSummary),
      );
      setCriteria((current) =>
        preserveDirtyRefreshValue(current, previousFormState.criteria, nextFormState.criteria, areJsonEqual),
      );
      setDefinitionOfDone((current) =>
        preserveDirtyRefreshValue(
          current,
          previousFormState.definitionOfDone,
          nextFormState.definitionOfDone,
          areJsonEqual,
        ),
      );
      setStatus((current) => preserveDirtyRefreshValue(current, previousFormState.status, nextFormState.status));
      setAssignee((current) =>
        preserveDirtyRefreshValue(current, previousFormState.assignee, nextFormState.assignee, areJsonEqual),
      );
      setLabels((current) =>
        preserveDirtyRefreshValue(current, previousFormState.labels, nextFormState.labels, areJsonEqual),
      );
      setPriority((current) => preserveDirtyRefreshValue(current, previousFormState.priority, nextFormState.priority));
      setTaskType((current) => preserveDirtyRefreshValue(current, previousFormState.taskType, nextFormState.taskType));
      setProject((current) => preserveDirtyRefreshValue(current, previousFormState.project, nextFormState.project));
      setDependencies((current) =>
        preserveDirtyRefreshValue(current, previousFormState.dependencies, nextFormState.dependencies, areJsonEqual),
      );
      setReferences((current) =>
        preserveDirtyRefreshValue(current, previousFormState.references, nextFormState.references, areJsonEqual),
      );
      setModifiedFiles((current) =>
        preserveDirtyRefreshValue(
          current,
          previousFormState.modifiedFiles,
          nextFormState.modifiedFiles,
          areJsonEqual,
        ),
      );
      setMilestone((current) =>
        preserveDirtyRefreshValue(current, previousFormState.milestone, nextFormState.milestone),
      );
      setDueDate((current) => preserveDirtyRefreshValue(current, previousFormState.dueDate, nextFormState.dueDate));
      setMode(shouldPreserveEditMode ? "edit" : isCreateMode ? "create" : modeRef.current);
      preserveEditModeAfterCommentRefresh.current = false;
      previousTaskId.current = nextTaskId;
      previousIsOpen.current = isOpen;
      formBaselineRef.current = nextFormState;
      setError(null);
      return;
    }

    setTitle(nextFormState.title);
    setSchemaFields(schemaFieldBaseline);
    schemaFieldBaselineRef.current = schemaFieldBaseline;
    setFieldErrors({});
    setDescription(nextFormState.description);
    setPlan(nextFormState.plan);
    setNotes(nextFormState.notes);
    setDisplayComments(nextFormState.displayComments);
    setCommentBody("");
    setCommentAuthor("");
    setCommentSaving(false);
    setCommentsChanged(false);
    setFinalSummary(nextFormState.finalSummary);
    setCriteria(nextFormState.criteria);
    setDefinitionOfDone(nextFormState.definitionOfDone);
    setStatus(nextFormState.status);
    setAssignee(nextFormState.assignee);
    setLabels(nextFormState.labels);
    setPriority(nextFormState.priority);
    setTaskType(nextFormState.taskType);
    setProject(nextFormState.project);
    setDependencies(nextFormState.dependencies);
    setReferences(nextFormState.references);
    setModifiedFiles(nextFormState.modifiedFiles);
    setMilestone(nextFormState.milestone);
    setDueDate(nextFormState.dueDate);
    setMode(isCreateMode ? "create" : "preview");
    preserveEditModeAfterCommentRefresh.current = false;
    previousTaskId.current = nextTaskId;
    previousIsOpen.current = isOpen;
    formBaselineRef.current = nextFormState;
    setError(null);
  }, [task, isOpen, isCreateMode, isDraftMode, availableStatuses, defaultDefinitionOfDone, createModeAssignee, schemaFieldBaseline]);

  const refreshAfterCommentChange = useCallback(() => {
    if (!commentsChanged) return;
    setCommentsChanged(false);
    if (onSaved) void onSaved();
  }, [commentsChanged, onSaved]);

  const hasCommentDraft = commentBody.trim() !== "" || commentAuthor.trim() !== "";
  // Nothing is persisted while creating, so any entered field is unsaved work.
  const hasCreateModeEntries =
    isCreateMode &&
    (title.trim() !== "" ||
      taskType.trim() !== "" ||
      priority.trim() !== "" ||
      project.trim() !== "" ||
      milestone.trim() !== "" ||
      dueDate.trim() !== "" ||
      // The prefilled default is not the user's work, but removing or replacing it is.
      !areJsonEqual(assignee, createModeAssignee) ||
      labels.length > 0 ||
      dependencies.length > 0 ||
      references.length > 0 ||
      modifiedFiles.length > 0);
  const hasUnsavedEdits =
    (mode === "edit" || mode === "create") && (isDirty || hasCommentDraft || hasCreateModeEntries);

  // Links inside the modal (dependency chips, auto-linked task IDs in markdown) leave this
  // task behind, so they ask the same question closing does before the navigation happens.
  const confirmNavigationAwayFromEdits = (event: React.MouseEvent<HTMLElement>) => {
    if (!hasUnsavedEdits || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    if (link.target && link.target !== "_self") return;
    const destination = new URL(link.href, window.location.href);
    if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
    // Same-page anchors (markdown heading links) do not unload the form.
    if (destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    if (window.confirm("Discard unsaved changes and leave this task?")) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleCancelEdit = () => {
    if (demoting) return;
    if (isDirty) {
      const confirmDiscard = window.confirm("Discard unsaved changes?");
      if (!confirmDiscard) return;
    }
    if (isCreateMode) {
      // In create mode, close the modal on cancel
      onClose();
    } else {
      setTitle(task?.title || "");
      setSchemaFields(schemaFieldBaseline);
      setFieldErrors({});
      setDescription(task?.description || "");
      setPlan(task?.implementationPlan || "");
      setNotes(task?.implementationNotes || "");
      setCommentBody("");
      setCommentAuthor("");
      setFinalSummary(task?.finalSummary || "");
      setDueDate(task?.dueDate || "");
      setCriteria(task?.acceptanceCriteriaItems || []);
      setDefinitionOfDone(task?.definitionOfDoneItems || []);
      setMode("preview");
      refreshAfterCommentChange();
    }
  };

  const normalizeChecklistItems = (items: AcceptanceCriterion[]): AcceptanceCriterion[] => {
    return items
      .map((item) => ({ ...item, text: item.text.trim() }))
      .filter((item) => item.text.length > 0);
  };

  const buildDefinitionOfDoneCreatePayload = (): TaskUpdatePayload => {
    const cleanedCurrent = normalizeChecklistItems(definitionOfDone);
    const defaults = (definitionOfDoneDefaults ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
    const defaultItems = defaults.map((text, index) => ({ index: index + 1, text, checked: false }));
    const defaultsMatch =
      cleanedCurrent.length >= defaultItems.length &&
      defaultItems.every(
        (item, index) =>
          cleanedCurrent[index]?.text === item.text && cleanedCurrent[index]?.checked === false,
      );

    const disableDefaults = !defaultsMatch;
    const definitionOfDoneAdd = disableDefaults
      ? cleanedCurrent.map((item) => item.text)
      : cleanedCurrent.slice(defaultItems.length).map((item) => item.text);

    const payload: TaskUpdatePayload = {};
    if (definitionOfDoneAdd.length > 0) {
      payload.definitionOfDoneAdd = definitionOfDoneAdd;
    }
    if (disableDefaults) {
      payload.disableDefinitionOfDoneDefaults = true;
    }
    return payload;
  };

  const buildDefinitionOfDoneEditPayload = (): TaskUpdatePayload => {
    const original = task?.definitionOfDoneItems ?? [];
    const cleanedCurrent = normalizeChecklistItems(definitionOfDone);
    const originalByIndex = new Map(original.map((item) => [item.index, item]));
    const currentByIndex = new Map(cleanedCurrent.map((item) => [item.index, item]));
    const removals = new Set<number>();
    const additions: string[] = [];
    const checks: number[] = [];
    const unchecks: number[] = [];

    let nextIndex = original.reduce((max, item) => Math.max(max, item.index), 0);

    for (const item of cleanedCurrent) {
      const originalItem = originalByIndex.get(item.index);
      if (!originalItem) {
        additions.push(item.text);
        nextIndex += 1;
        if (item.checked) {
          checks.push(nextIndex);
        }
        continue;
      }
      if (originalItem.text !== item.text) {
        removals.add(item.index);
        additions.push(item.text);
        nextIndex += 1;
        if (item.checked) {
          checks.push(nextIndex);
        }
        continue;
      }
      if (originalItem.checked !== item.checked) {
        if (item.checked) {
          checks.push(item.index);
        } else {
          unchecks.push(item.index);
        }
      }
    }

    for (const originalItem of original) {
      if (!currentByIndex.has(originalItem.index)) {
        removals.add(originalItem.index);
      }
    }

    const payload: TaskUpdatePayload = {};
    if (additions.length > 0) {
      payload.definitionOfDoneAdd = additions;
    }
    if (removals.size > 0) {
      payload.definitionOfDoneRemove = Array.from(removals);
    }
    if (checks.length > 0) {
      payload.definitionOfDoneCheck = checks;
    }
    if (unchecks.length > 0) {
      payload.definitionOfDoneUncheck = unchecks;
    }
    return payload;
  };

  const handleSave = async () => {
    if (demoting) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Validation for create mode
    if (isCreateMode && !title.trim()) {
      setError("Title is required");
      setSaving(false);
      return;
    }

    try {
      const taskData: TaskUpdatePayload = {
        title: title.trim(),
        description,
        implementationPlan: plan,
        implementationNotes: notes,
        finalSummary,
        acceptanceCriteriaItems: criteria,
        status,
        // Create starts with the configured defaultAssignee in the field, so what the field
        // holds is what the user meant: empty is an explicit "unassigned". Only a project
        // without a default has nothing to remove, so there a blank field still omits the
        // field. On edit an explicit empty list clears the assignees.
        ...(isCreateMode && assignee.length === 0 && createModeAssignee.length === 0 ? {} : { assignee }),
        labels,
        priority: priority === "" ? undefined : priority,
        dependencies,
        milestone: milestone.trim().length > 0 ? milestone.trim() : undefined,
        dueDate: dueDate.trim().length > 0 ? dueDate.trim() : isCreateMode ? undefined : null,
      };

      // Like type, project is only sent from the create form. On edit the sidebar select
      // persists immediately through handleInlineMetaUpdate, so including it here would
      // re-send a value the form never showed -- clearing a stale project when none are
      // configured, or failing the whole save when the stored value is no longer valid.
      if (isCreateMode) {
        taskData.type = taskType;
        taskData.project = project.trim().length > 0 ? project.trim() : undefined;
      }

      if (isCreateMode && onSubmit) {
        Object.assign(taskData, buildDefinitionOfDoneCreatePayload());
        // Create new task
        await onSubmit({ ...taskData, dueDate: taskData.dueDate ?? undefined } as Partial<Task>);
        // Only close if successful (no error thrown)
        onClose();
      } else if (task) {
        const fieldChanges = Object.fromEntries(Object.entries(schemaFields).filter(([key, value]) =>
          !schema.fields[key]?.managed && !areJsonEqual(value, schemaFieldBaseline[key]),
        ));
        const legacyBodyChanged = description !== baseline.description || plan !== baseline.plan || notes !== baseline.notes ||
          finalSummary !== baseline.finalSummary || JSON.stringify(criteria) !== baseline.criteria ||
          JSON.stringify(definitionOfDone) !== baseline.definitionOfDone;
        if (legacyBodyChanged) {
          Object.assign(taskData, buildDefinitionOfDoneEditPayload());
          await apiClient.updateTask(task.id, taskData);
        }
        if (Object.keys(fieldChanges).length > 0) {
          await apiClient.patchSchemaTask(task.id, { fields: fieldChanges });
        }
        setMode("preview");
        if (onSaved) await onSaved();
        setCommentsChanged(false);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && typeof err.data === "object" && err.data !== null && "errors" in err.data) {
        const issues = (err.data as { errors?: Array<{ key: string; message: string }> }).errors ?? [];
        setFieldErrors(Object.fromEntries(issues.filter((issue) => issue.key.startsWith("fields.")).map((issue) => [issue.key.slice(7), issue.message])));
      }
      // Extract and display the error message from API response
      let errorMessage = 'Failed to save task';

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'object' && err !== null && 'error' in err) {
        errorMessage = String((err as any).error);
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCriterion = async (index: number, checked: boolean) => {
    if (demoting) return;
    if (!task) return; // Can't toggle in create mode
    if (isReadOnly) return; // Can't toggle on a read-only task
    // Optimistic update
    const next = (criteria || []).map((c) => (c.index === index ? { ...c, checked } : c));
    setCriteria(next);
    try {
      await apiClient.updateTask(task.id, { acceptanceCriteriaItems: next });
      if (onSaved) await onSaved();
    } catch (err) {
      // rollback
      setCriteria(criteria);
      console.error("Failed to update criterion", err);
    }
  };

  const handleToggleDefinitionOfDone = async (index: number, checked: boolean) => {
    if (demoting) return;
    if (!task) return; // Can't toggle in create mode
    if (isReadOnly) return; // Can't toggle on a read-only task
    const next = (definitionOfDone || []).map((c) => (c.index === index ? { ...c, checked } : c));
    setDefinitionOfDone(next);
    try {
      const updates: TaskUpdatePayload = checked
        ? { definitionOfDoneCheck: [index] }
        : { definitionOfDoneUncheck: [index] };
      await apiClient.updateTask(task.id, updates);
      if (onSaved) await onSaved();
    } catch (err) {
      setDefinitionOfDone(definitionOfDone);
      console.error("Failed to update Definition of Done item", err);
    }
  };

  const handleInlineMetaUpdate = async (updates: InlineMetaUpdatePayload) => {
    if (demoting) return;
    // Don't allow updates on a read-only task
    if (isReadOnly) return;

    setError(null);

    // Optimistic UI
    if (updates.status !== undefined) setStatus(String(updates.status));
    if (updates.assignee !== undefined) setAssignee(updates.assignee as string[]);
    if (updates.labels !== undefined) setLabels(updates.labels as string[]);
    if (updates.priority !== undefined) setPriority(String(updates.priority));
    if (updates.type !== undefined) setTaskType(String(updates.type));
    if (updates.project !== undefined) setProject(String(updates.project));
    if (updates.dependencies !== undefined) setDependencies(updates.dependencies as string[]);
    if (updates.references !== undefined) setReferences(updates.references as string[]);
    if (updates.modifiedFiles !== undefined) setModifiedFiles(updates.modifiedFiles as string[]);
    if (updates.milestone !== undefined) setMilestone((updates.milestone ?? "") as string);

    // Only update server if editing existing task
    if (task) {
      try {
        await apiClient.updateTask(task.id, updates);
        if (onSaved) await onSaved();
      } catch (err) {
        console.error("Failed to update task metadata", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handleAddComment = async () => {
    if (demoting) return;
    if (!task || isReadOnly) return;
    const body = commentBody.trim();
    if (!body) return;
    const author = commentAuthor.trim();
    if (containsCommentDelimiterLine(body)) {
      setError("Comment body cannot contain standalone '---' delimiter lines.");
      return;
    }
    if (author && containsCommentDelimiterLine(author)) {
      setError("Comment author cannot contain standalone '---' delimiter lines.");
      return;
    }
    setCommentSaving(true);
    setError(null);
    preserveEditModeAfterCommentRefresh.current = true;
    try {
      const updatedTask = await apiClient.updateTask(task.id, {
        commentsAppend: [body],
        ...(author.length > 0 && { commentAuthor: author }),
      });
      setDisplayComments(updatedTask.comments ?? []);
      setCommentsChanged(true);
      setCommentBody("");
      setCommentAuthor("");
    } catch (err) {
      preserveEditModeAfterCommentRefresh.current = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommentSaving(false);
    }
  };

  // labels handled via ChipInput; no textarea parsing

	const handleDemote = async () => {
		if (!task || !canDemote || activeDemotionRequest.current !== null) return;
		if (!window.confirm(`Demote "${task.title}" to draft? It will be moved to the drafts folder.`)) return;

		const request = { identity: demotionIdentity };
		activeDemotionRequest.current = request;
		const isCurrentRequest = () =>
			activeDemotionRequest.current === request && demotionIdentityRef.current === request.identity;
		const finishWithRefreshWarning = async (message: string) => {
			window.dispatchEvent(new window.Event("drafts-updated"));
			try {
				if (onSaved) await onSaved();
			} catch (refreshError) {
				console.error("Task was demoted, but refreshing the Web UI failed", refreshError);
			}
			if (!isCurrentRequest()) return;
			try {
				window.alert(message);
			} catch {
				setError(message);
			}
			onClose();
		};
		setDemoting(true);
		setError(null);
		try {
			const { cleanedTaskIds } = await apiClient.demoteTask(task.id);
			if (!isCurrentRequest()) return;
			onDependencyCleanup?.(task.id, cleanedTaskIds);
			try {
				window.dispatchEvent(new window.Event("drafts-updated"));
				if (onSaved) await onSaved();
			} catch {
				await finishWithRefreshWarning(
					"The task was moved to drafts, but refreshing the view failed. Close this dialog and verify the draft before retrying.",
				);
				return;
			}
			if (!isCurrentRequest()) return;
			onClose();
		} catch (err) {
			if (!isCurrentRequest()) return;
			const demotionFailureState = readMovedFailureState(err, "demotionState");
			if (demotionFailureState) {
				const demotionFailureCause = readDemotionFailureCause(err);
				const message =
					demotionFailureState === "moved"
						? demotionFailureCause === "cleanup"
							? "The task was moved to drafts, but removing references from dependent tasks failed. Some dependent tasks may still reference it. The view was refreshed; check those tasks before retrying."
							: demotionFailureCause === "commit"
								? "The task was moved to drafts, but recording the Git commit failed. The view was refreshed; verify the draft before retrying."
								: "The task was moved to drafts, but a later step failed. The view was refreshed; verify the draft and dependent tasks before retrying."
						: "The demotion encountered a filesystem failure and may have left both task and draft copies. The view was refreshed; inspect them before retrying.";
				await finishWithRefreshWarning(message);
				return;
			}
			if (err instanceof NetworkError) {
				await finishWithRefreshWarning(
					"The demotion request may have succeeded, but its response was lost. Check the task and drafts views before retrying.",
				);
				return;
			}
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			if (isCurrentRequest()) {
				activeDemotionRequest.current = null;
				setDemoting(false);
			}
		}
	};

  const handleArchive = async () => {
    if (demoting) return;
    if (!task || !onArchive) return;
    if (!window.confirm(`Archive "${task.title}"? It moves off the board. Its ID, record, dependencies, and references are kept.`)) return;
    setError(null);
    try {
      await onArchive();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const checkedCount = (criteria || []).filter((c) => c.checked).length;
  const totalCount = (criteria || []).length;
  const definitionCheckedCount = (definitionOfDone || []).filter((c) => c.checked).length;
  const definitionTotalCount = (definitionOfDone || []).length;
	const canDemote = Boolean(task && !isDraftMode && !isOpenDraft && !isReadOnly);
  const comments = displayComments;

  const displayId = task?.id ?? "";
  const documentation = task?.documentation ?? [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
		if (demoting) return;
        // When in edit mode, confirm closing if dirty
        if (mode === "edit" && isDirty) {
          if (!window.confirm("Discard unsaved changes and close?")) return;
        }
        refreshAfterCommentChange();
        onClose();
      }}
      title={isCreateMode ? (isDraftMode ? "Create New Draft" : "Create New Task") : `${displayId} — ${task.title}`}
      maxWidthClass="max-w-5xl"
      disableEscapeClose={mode === "edit" || mode === "create" || demoting}
      actions={
		<div className="flex flex-nowrap items-center justify-end gap-2">
		          {canDemote && mode === "preview" && (
		            <button
		              onClick={() => void handleDemote()}
		              disabled={demoting}
		              className="inline-flex items-center px-3 py-2 sm:px-4 rounded-lg text-sm font-medium text-white bg-amber-500 dark:bg-amber-600 hover:bg-amber-600 dark:hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:focus:ring-amber-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
		              title="Move task to drafts"
		            >
		              {demoting ? "Demoting…" : (
		                <>
		                  <span className="sm:hidden">Demote</span>
		                  <span className="hidden sm:inline">Demote to draft</span>
		                </>
		              )}
		            </button>
		          )}
		          {mode === "preview" && !isCreateMode && !isReadOnly ? (
		            <button
		              onClick={() => setMode("edit")}
		              disabled={demoting}
		              className="inline-flex items-center px-3 py-2 sm:px-4 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
		              title="Edit"
		            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          ) : (mode === "edit" || mode === "create") ? (
            <div className="flex items-center gap-2">
	              <button
		                onClick={handleCancelEdit}
		                disabled={demoting}
		                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200"
		                title="Cancel"
		              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
	              <button
		                onClick={() => void handleSave()}
		                disabled={saving || demoting}
		                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-900 transition-colors duration-200 disabled:opacity-50"
		                title="Save"
		              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {saving ? "Saving…" : (isCreateMode ? "Create" : "Save")}
              </button>
            </div>
          ) : null}
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

		<fieldset disabled={demoting} className="contents" aria-busy={demoting}>
      {/* One banner for every read-only task; only the reason differs. */}
      {isReadOnly && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-amber-800 dark:text-amber-200">
          <svg className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <div className="flex-1">
            <span className="font-medium">Read-only:</span>{" "}
            {task?.branch ? (
              <>This task exists in the <span className="font-semibold">{task.branch}</span> branch. Switch to that branch to edit it.</>
            ) : (
              "This task is archived."
            )}
          </div>
        </div>
      )}

      {parentTask && task && (
        <nav
          aria-label="Task hierarchy"
          className="mb-4"
          data-task-hierarchy
          onClickCapture={confirmNavigationAwayFromEdits}
        >
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <li className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Parent
            </li>
            <li className="min-w-0 max-w-full">
              <button
                type="button"
                onClick={() => onNavigateToTask?.(parentTask)}
                disabled={!onNavigateToTask}
                data-parent-task-id={parentTask.id}
                data-parent-task-href={createUrlPath('/tasks', parentTask.id, parentTask.title)}
                className="group inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1 text-left text-gray-700 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white"
                aria-label={`Open parent task ${parentTask.id}: ${parentTask.title} (${parentTask.status})`}
              >
                <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {parentTask.id}
                </span>
                <span className="min-w-0 break-words font-medium">{parentTask.title}</span>
                <HierarchyStatusBadge status={parentTask.status} statuses={availableStatuses} />
              </button>
            </li>
            <li aria-hidden="true">
              <HierarchyChevron />
            </li>
            <li aria-current="page" className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {task.id}
            </li>
          </ol>
        </nav>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" onClickCapture={confirmNavigationAwayFromEdits}>
        {/* Main content */}
        <div className="md:col-span-2 space-y-6">
          {/* Title field for create mode */}
          {isCreateMode && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Title" />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter task title"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors duration-200"
              />
            </div>
          )}
          {/* Description */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title="Description" />
            {mode === "preview" ? (
              description ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={description} />
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No description</div>
              )
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                <MDEditor
                  value={description}
                  onChange={(val) => setDescription(val || "")}
                  preview="edit"
                  height={320}
                  data-color-mode={theme}
                />
              </div>
            )}
          </div>

          {subtasks.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <SectionHeader
                title="Subtasks"
                right={
                  subtaskProgress
                    ? `${subtaskProgress.completed} of ${subtaskProgress.total} complete`
                    : undefined
                }
              />
              <div className="divide-y divide-gray-100 dark:divide-gray-700" data-subtask-list>
                {subtasks.map((subtask) => {
                  const nested = summarizeSubtaskProgress(subtask, availableTasks, availableStatuses);
                  return (
                    <button
                      key={subtask.id}
                      type="button"
                      onClick={() => onNavigateToTask?.(subtask)}
                      disabled={!onNavigateToTask}
                      data-subtask-id={subtask.id}
                      data-subtask-href={createUrlPath('/tasks', subtask.id, subtask.title)}
                      className="group flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-gray-700/50"
                      aria-label={`Open subtask ${subtask.id}: ${subtask.title} (${subtask.status})`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                            {subtask.id}
                          </span>
                          <HierarchyStatusBadge status={subtask.status} statuses={availableStatuses} />
                          {nested && (
                            <span
                              className="text-xs text-gray-500 dark:text-gray-400"
                              data-nested-progress={`${nested.completed}/${nested.total}`}
                            >
                              {nested.completed} of {nested.total} complete
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block break-words text-sm font-medium text-gray-900 dark:text-gray-100">
                          {subtask.title}
                        </span>
                      </span>
                      <HierarchyChevron />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* References */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title="References" />
            <div className="space-y-3">
              {references.length > 0 ? (
                <ul className="space-y-2">
                  {references.map((ref, idx) => (
                    <li key={idx} className="flex items-center gap-3 group">
                      <span className="flex-1 min-w-0">
                        {ref.startsWith("http://") || ref.startsWith("https://") ? (
                          <a
                            href={ref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            {ref}
                          </a>
                        ) : (
                          <code className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded break-all">
                            {ref}
                          </code>
                        )}
                      </span>
                      {!isReadOnly && (
                        <button
                          onClick={() => {
                            const newRefs = references.filter((_, i) => i !== idx);
                            handleInlineMetaUpdate({ references: newRefs });
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                          title="Remove reference"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No references</p>
              )}
              {mode === "preview" && !isReadOnly && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("newRef") as HTMLInputElement;
                    const value = input.value.trim();
                    if (value && !references.includes(value)) {
                      handleInlineMetaUpdate({ references: [...references, value] });
                      input.value = "";
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="newRef"
                    type="text"
                    placeholder="URL or file path..."
                    className="flex-1 text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Modified files */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title={`Modified files${modifiedFiles.length ? ` (${modifiedFiles.length})` : ""}`} />
            <div className="space-y-3">
              {modifiedFiles.length > 0 ? (
                // A finished task can list hundreds of paths, so the list scrolls inside the
                // section instead of pushing the sections below it out of reach.
                <ul className="space-y-2 max-h-64 overflow-y-auto overscroll-contain pr-1">
                  {modifiedFiles.map((file, idx) => (
                    <li key={idx} className="flex items-start gap-3 group">
                      <span className="flex-1 min-w-0">
                        <code className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded break-all">
                          {file}
                        </code>
                      </span>
                      {!isReadOnly && (
                        <button
                          onClick={() => {
                            const newFiles = modifiedFiles.filter((_, i) => i !== idx);
                            handleInlineMetaUpdate({ modifiedFiles: newFiles });
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all flex-shrink-0 mt-0.5"
                          title="Remove modified file"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No modified files</p>
              )}
              {mode === "preview" && !isReadOnly && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.elements.namedItem("newModifiedFile") as HTMLInputElement;
                    const value = input.value.trim();
                    if (value && !modifiedFiles.includes(value)) {
                      handleInlineMetaUpdate({ modifiedFiles: [...modifiedFiles, value] });
                      input.value = "";
                    }
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="newModifiedFile"
                    type="text"
                    placeholder="Path from project root..."
                    className="flex-1 text-sm px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Documentation */}
          {documentation.length > 0 && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Documentation" />
              <div className="space-y-2">
                <ul className="space-y-2">
                  {documentation.map((doc, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <span className="flex-1 min-w-0">
                        {doc.startsWith("http://") || doc.startsWith("https://") ? (
                          <a
                            href={doc}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            {doc}
                          </a>
                        ) : (
                          <code className="text-sm font-mono text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded break-all">
                            {doc}
                          </code>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Acceptance Criteria */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader
              title={`Acceptance Criteria ${totalCount ? `(${checkedCount}/${totalCount})` : ""}`}
              right={mode === "preview" && !isReadOnly ? (
                <span>Toggle to update</span>
              ) : null}
            />
            {mode === "preview" ? (
              <ul className="space-y-2">
                {(criteria || []).map((c) => (
                  <li key={c.index} className="flex items-start gap-2 rounded-md px-2 py-1">
                    <input
                      type="checkbox"
                      checked={c.checked}
                      disabled={isReadOnly}
                      onChange={(e) => void handleToggleCriterion(c.index, e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {`#${c.index}`}
                    </span>
                    <div className="text-sm text-gray-800 dark:text-gray-100">{c.text}</div>
                  </li>
                ))}
                {totalCount === 0 && (
                  <li className="text-sm text-gray-500 dark:text-gray-400">No acceptance criteria</li>
                )}
              </ul>
            ) : (
              <AcceptanceCriteriaEditor criteria={criteria} onChange={setCriteria} />
            )}
          </div>

          {/* Definition of Done */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader
              title={`Definition of Done ${definitionTotalCount ? `(${definitionCheckedCount}/${definitionTotalCount})` : ""}`}
              right={mode === "preview" && !isReadOnly ? (
                <span>Toggle to update</span>
              ) : null}
            />
            {mode === "preview" ? (
              <ul className="space-y-2">
                {(definitionOfDone || []).map((item) => (
                  <li key={item.index} className="flex items-start gap-2 rounded-md px-2 py-1">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={isReadOnly}
                      onChange={(e) => void handleToggleDefinitionOfDone(item.index, e.target.checked)}
                      className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="text-sm text-gray-800 dark:text-gray-100">{item.text}</div>
                  </li>
                ))}
                {definitionTotalCount === 0 && (
                  <li className="text-sm text-gray-500 dark:text-gray-400">No Definition of Done items</li>
                )}
              </ul>
            ) : (
              <AcceptanceCriteriaEditor
                criteria={definitionOfDone}
                onChange={setDefinitionOfDone}
                label="Definition of Done"
                preserveIndices
                disableToggle={isCreateMode}
              />
            )}
          </div>

          {dependencyGraph && dependencyGraph.nodes.length > 1 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <SectionHeader title="Dependency Graph" />
              <DependencyGraphSection graph={dependencyGraph} />
            </section>
          )}

          {/* Implementation Plan */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title="Implementation Plan" />
            {mode === "preview" ? (
              plan ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={plan} />
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No plan</div>
              )
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                <MDEditor
                  value={plan}
                  onChange={(val) => setPlan(val || "")}
                  preview="edit"
                  height={280}
                  data-color-mode={theme}
                />
              </div>
            )}
          </div>

          {/* Implementation Notes */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <SectionHeader title="Implementation Notes" />
            {mode === "preview" ? (
              notes ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={notes} />
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No notes</div>
              )
            ) : (
              <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                <MDEditor
                  value={notes}
                  onChange={(val) => setNotes(val || "")}
                  preview="edit"
                  height={280}
                  data-color-mode={theme}
                />
              </div>
            )}
          </div>

          {/* Comments */}
          {!isCreateMode && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title={`Comments${comments.length ? ` (${comments.length})` : ""}`} />
              {comments.length > 0 ? (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <article key={`${comment.index}-${comment.createdDate}`} className="border-l-2 border-gray-200 dark:border-gray-700 pl-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-200">#{comment.index}</span>
                        {comment.author ? <span>{comment.author}</span> : null}
                        {comment.createdDate ? <StoredDate value={comment.createdDate} dateFormat={dateFormat} /> : null}
                      </div>
                      <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                        <MermaidMarkdown source={comment.body} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No comments</div>
              )}
              {mode === "edit" && !isReadOnly && (
                <div className="mt-4 space-y-2">
                  <input
                    type="text"
                    value={commentAuthor}
                    onChange={(e) => setCommentAuthor(e.target.value)}
                    placeholder="Author"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent transition-colors duration-200"
                  />
                  <textarea
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    rows={4}
                    placeholder="Add a comment..."
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleAddComment()}
                      disabled={commentSaving || commentBody.trim().length === 0}
                      className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
                    >
                      {commentSaving ? "Adding..." : "Add comment"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Final Summary */}
          {(mode !== "preview" || finalSummary.trim().length > 0) && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <SectionHeader title="Final Summary" right="Completion summary" />
              {mode === "preview" ? (
                <div className="prose prose-sm !max-w-none wmde-markdown" data-color-mode={theme}>
                  <MermaidMarkdown source={finalSummary} />
                </div>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md">
                  <MDEditor
                    value={finalSummary}
                    onChange={(val) => setFinalSummary(val || "")}
                    preview="edit"
                    height={220}
                    data-color-mode={theme}
                    textareaProps={{
                      placeholder: "PR-style summary of what was implemented (write when task is complete)",
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="md:col-span-1 space-y-4">
          <SchemaSidebar
            values={schemaFields}
            onChange={(key, value) => {
              setSchemaFields((current) => ({ ...current, [key]: value }));
              setFieldErrors((current) => ({ ...current, [key]: "" }));
            }}
            mode={mode === "preview" ? "view" : mode}
            readOnly={isReadOnly}
            draft={isOpenDraft}
            errors={fieldErrors}
            availableTasks={availableTasks}
            milestones={milestoneEntities}
            dateFormat={dateFormat}
          />
          {shownReadiness && (
            <div className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${shownReadiness.isReady ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'}`}>
              <span aria-hidden="true">{shownReadiness.isReady ? '✓' : '⏳'}</span>
              <span>{shownReadiness.isReady ? 'Ready to start' : formatReadinessBlockers(shownReadiness)}</span>
            </div>
          )}

          {/* Archive button at bottom of sidebar */}
		          {task && onArchive && !isReadOnly && (
		            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
		              <button
		                onClick={handleArchive}
		                title="Move this task off the board into the archive"
		                disabled={demoting}
		                className="w-full inline-flex items-center justify-center px-4 py-2 bg-red-500 dark:bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-600 dark:hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 focus:ring-red-400 dark:focus:ring-red-500 transition-colors duration-200"
		              >
		                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
                Archive Task
              </button>
            </div>
          )}
        </div>
	      </div>
		</fieldset>
    </Modal>
  );
};

export default TaskDetailsModal;
