import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isReadOnlyTask, isWorkingCopyTask, type AcceptanceCriterion, type Milestone, type Task, type TaskComment } from "../../types";
import { type TaskDetail, taskDependencyGraph, taskReadiness } from "../../core/task-detail";
import Modal from "./Modal";
import { apiClient, ApiError, NetworkError, readDemotionFailureCause, readMovedFailureState, type SchemaTaskWrite } from "../lib/api";
import type { FieldValue as RegistryFieldValue } from "../../schema/field-registry.ts";
import { parseSections, type ChecklistItem, type LogEntry, type LogInput, type SectionValue } from "../../markdown/sections.ts";
import { useSchema } from "./schema/SchemaProvider.tsx";
import SchemaSidebar from "./schema/SchemaSidebar.tsx";
import SchemaSections from "./schema/SchemaSections.tsx";
import FieldInput from "./schema/FieldInput.tsx";
import { DependencyGraphSection } from "./DependencyGraphSection";
import { formatReadinessBlockers } from "../../utils/readiness";
import { buildTaskIdIndex, resolveTaskReference } from "../utils/task-id-links";
import { findDirectSubtasks, findParentTask, summarizeSubtaskProgress } from "../../utils/task-subtasks.ts";
import { isTerminalStatus } from "../../utils/terminal-status.ts";
import { createUrlPath } from "../utils/urlHelpers";
import TaskDisplayTitle, { useTaskDisplay } from "./schema/TaskDisplayTitle.tsx";

interface Props {
  task?: Task | TaskDetail; // Optional for create mode
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => Promise<void> | void; // refresh callback
  onSubmit?: (taskData: SchemaTaskWrite) => Promise<void>; // For creating new tasks
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

function readSchemaSectionValues(task: Task | TaskDetail | undefined, schema: ReturnType<typeof useSchema>["schema"]): { sections: Record<string, SectionValue>; other: string } {
  const supplied = task as SchemaTask | undefined;
  if (supplied?.sections) return { sections: supplied.sections, other: supplied.other ?? "" };
  const parsed = task?.rawContent ? parseSections(task.rawContent, schema) : null;
  const sections: Record<string, SectionValue> = {};
  for (const [id, definition] of Object.entries(schema.sections)) {
    const fromSource = parsed?.sections[id];
    if (fromSource && (typeof fromSource === "string" ? fromSource.trim() : fromSource.length > 0)) sections[id] = fromSource;
    else if (id === "description" && task?.description) sections[id] = task.description;
    else if (id === "acceptance" && task?.acceptanceCriteriaItems) sections[id] = task.acceptanceCriteriaItems;
    else if (id === "log" && task?.comments) sections[id] = task.comments.map((comment) => ({ author: comment.author ?? "", date: comment.createdDate.slice(0, 10), createdAt: comment.createdDate, body: comment.body }));
    else sections[id] = definition.kind === "markdown" ? "" : [];
  }
  return { sections, other: supplied?.other ?? "" };
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

const preserveDirtyRecord = <T,>(current: Record<string, T>, previous: Record<string, T>, next: Record<string, T>): Record<string, T> => {
  const merged: Record<string, T> = { ...next };
  for (const key of new Set([...Object.keys(current), ...Object.keys(previous)])) {
    if (areJsonEqual(current[key], previous[key])) continue;
    const value = current[key];
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
};

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
  const { schema, registry } = useSchema();
  const isCreateMode = !task;
  const schemaFieldBaseline = useMemo(() => readSchemaFieldValues(task, registry, isDraftMode), [task, registry, isDraftMode]);
  const [schemaFields, setSchemaFields] = useState<Record<string, RegistryFieldValue | null>>(schemaFieldBaseline);
  const schemaFieldBaselineRef = useRef(schemaFieldBaseline);
  const schemaSectionBaseline = useMemo(() => readSchemaSectionValues(task, schema), [task, schema]);
  const [schemaSections, setSchemaSections] = useState(schemaSectionBaseline.sections);
  const schemaSectionBaselineRef = useRef(schemaSectionBaseline.sections);
  const [pendingLog, setPendingLog] = useState<{ section: string; entry: LogInput } | null>(null);
  const [logDrafts, setLogDrafts] = useState<Record<string, boolean>>({});
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
	const [checklistBusy, setChecklistBusy] = useState(false);
	const checklistBusyRef = useRef(false);
  const [demoting, setDemoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Title field for create mode
  const [title, setTitle] = useState(task?.title || "");

  // Editable fields (edit mode)
  const [description, setDescription] = useState(task?.description || "");
  const [plan, setPlan] = useState(task?.implementationPlan || "");
  const [notes, setNotes] = useState(task?.implementationNotes || "");
  const [, setDisplayComments] = useState<TaskComment[]>(task?.comments ?? []);
  const [commentBody, setCommentBody] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [, setCommentSaving] = useState(false);
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
    Array.isArray(schemaFields.dependencies) &&
    schemaFields.dependencies.length > 0 &&
    schemaFields.dependencies.join(",") === (task?.dependencies ?? []).join(",") &&
    schemaFields.status === (task?.status ?? "")
      ? readiness
      : null;

  const localAvailableTasks = useMemo(() => {
    const local = availableTasks.filter(isWorkingCopyTask);
    const index = buildTaskIdIndex(local);
    return local.filter((candidate) => resolveTaskReference(index, candidate.id) === candidate);
  }, [availableTasks]);

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
      !areJsonEqual(schemaSections, schemaSectionBaseline.sections) ||
      JSON.stringify(criteria) !== baseline.criteria ||
      JSON.stringify(definitionOfDone) !== baseline.definitionOfDone
    );
  }, [title, description, plan, notes, finalSummary, dueDate, criteria, definitionOfDone, baseline, schemaFields, schemaFieldBaseline, schemaSections, schemaSectionBaseline]);

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
      const previousFields = schemaFieldBaselineRef.current;
      const previousSections = schemaSectionBaselineRef.current;
      setSchemaFields((current) => preserveDirtyRecord(current, previousFields, schemaFieldBaseline));
      schemaFieldBaselineRef.current = schemaFieldBaseline;
      setSchemaSections((current) => preserveDirtyRecord(current, previousSections, schemaSectionBaseline.sections));
      schemaSectionBaselineRef.current = schemaSectionBaseline.sections;
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
    setSchemaSections(schemaSectionBaseline.sections);
    schemaSectionBaselineRef.current = schemaSectionBaseline.sections;
    setPendingLog(null);
    setLogDrafts({});
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
  }, [task, isOpen, isCreateMode, isDraftMode, availableStatuses, defaultDefinitionOfDone, createModeAssignee, schemaFieldBaseline, schemaSectionBaseline]);

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
    (mode === "edit" || mode === "create") && (isDirty || hasCommentDraft || Object.values(logDrafts).some(Boolean) || hasCreateModeEntries);

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
      setSchemaSections(schemaSectionBaseline.sections);
      setPendingLog(null);
      setLogDrafts({});
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

  const handleSave = async () => {
    if (demoting) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Validation for create mode
    if (isCreateMode && !String(schemaFields.title ?? "").trim()) {
      setError("Title is required");
      setSaving(false);
      return;
    }

    try {
      if (isCreateMode && onSubmit) {
        const fields = Object.fromEntries(Object.entries(schemaFields).filter(([key, value]) =>
          key !== "title" && !schema.fields[key]?.managed && value !== null && value !== undefined && value !== "",
        ));
        const sections: Record<string, string> = {};
        const checklist: NonNullable<SchemaTaskWrite["checklist"]> = [];
        for (const [id, definition] of Object.entries(schema.sections)) {
          const value = schemaSections[id];
          if (definition.kind === "markdown" && typeof value === "string" && value.trim()) sections[id] = value;
          if (definition.kind === "checklist" && Array.isArray(value)) {
            const items = value.filter((item): item is AcceptanceCriterion => "checked" in item && Boolean(item.text.trim()));
            for (const item of items) checklist.push({ section: id, op: "add", text: item.text.trim() });
            items.forEach((item, index) => { if (item.checked) checklist.push({ section: id, op: "check", index: index + 1 }); });
          }
        }
        await onSubmit({
          title: String(schemaFields.title).trim(),
          fields,
          ...(Object.keys(sections).length ? { sections } : {}),
          ...(checklist.length ? { checklist } : {}),
          ...(pendingLog ? { log: { section: pendingLog.section, ...pendingLog.entry } } : {}),
        });
        onClose();
      } else if (task) {
        const fieldChanges = Object.fromEntries(Object.entries(schemaFields).filter(([key, value]) =>
          !schema.fields[key]?.managed && !areJsonEqual(value, schemaFieldBaseline[key]),
        ));
        const markdownChanges: Record<string, string> = {};
        const checklistChanges: NonNullable<SchemaTaskWrite["checklist"]> = [];
        for (const [id, definition] of Object.entries(schema.sections)) {
          const current = schemaSections[id];
          const previous = schemaSectionBaseline.sections[id];
          if (areJsonEqual(current, previous)) continue;
          if (definition.kind === "markdown" && typeof current === "string") markdownChanges[id] = current;
          else if (definition.kind === "checklist" && Array.isArray(current)) {
            checklistChanges.push({ section: id, op: "replace", items: current.filter((item): item is AcceptanceCriterion => "checked" in item) });
          }
        }
        if (Object.keys(fieldChanges).length || Object.keys(markdownChanges).length || checklistChanges.length) {
          await apiClient.patchSchemaTask(task.id, {
            ...(Object.keys(fieldChanges).length ? { fields: fieldChanges } : {}),
            ...(Object.keys(markdownChanges).length ? { sections: markdownChanges } : {}),
            ...(checklistChanges.length ? { checklist: checklistChanges } : {}),
          });
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

  const handleAppendLog = async (section: string, entry: LogInput) => {
    if (isReadOnly) throw new Error("This task is read-only.");
    if (!task) {
      if (pendingLog) throw new Error("Create the task before adding another log entry.");
      setPendingLog({ section, entry });
      setSchemaSections((current) => ({
        ...current,
        [section]: [...(Array.isArray(current[section]) ? current[section].filter((item): item is LogEntry => "body" in item) : []), {
          author: entry.author ?? "", date: entry.date ?? new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(), body: entry.body,
        }],
      }));
      return;
    }
    await apiClient.patchSchemaTask(task.id, { log: { section, body: entry.body, author: entry.author, date: entry.date } });
    if (onSaved) await onSaved();
  };

	const handleToggleChecklist = async (section: string, index: number, checked: boolean) => {
		if (!task || isReadOnly || checklistBusyRef.current) return;
		const previous = schemaSections[section];
		if (!Array.isArray(previous) || !previous.some((item) => "checked" in item && item.index === index)) return;
		checklistBusyRef.current = true;
		setChecklistBusy(true);
		setError(null);
		setSchemaSections((current) => ({ ...current, [section]: (current[section] as ChecklistItem[]).map((item) => item.index === index ? { ...item, checked } : item) }));
		try {
			await apiClient.patchSchemaTask(task.id, { checklist: [{ section, op: checked ? "check" : "uncheck", index }] });
		} catch (failure) {
			if (previousTaskId.current === task.id) {
				setSchemaSections((current) => ({ ...current, [section]: previous }));
				setError(failure instanceof Error ? failure.message : String(failure));
			}
			return;
		} finally {
			checklistBusyRef.current = false;
			setChecklistBusy(false);
		}
		try {
			if (onSaved) await onSaved();
		} catch (failure) {
			if (previousTaskId.current === task.id) setError(`Checklist saved, but refresh failed: ${failure instanceof Error ? failure.message : String(failure)}`);
		}
	};

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

	const canDemote = Boolean(task && !isDraftMode && !isOpenDraft && !isReadOnly);
	const { title: displayTitle } = useTaskDisplay();
  const displayId = task?.id ?? "";

  return (
    <Modal
      isOpen={isOpen}
	  scrollKey={task?.id ?? "create"}
      onClose={() => {
		if (demoting) return;
        // When in edit mode, confirm closing if dirty
        if (mode === "edit" && isDirty) {
          if (!window.confirm("Discard unsaved changes and close?")) return;
        }
        refreshAfterCommentChange();
        onClose();
      }}
      title={isCreateMode ? (isDraftMode ? "Create New Draft" : "Create New Task") : <>{displayId} — <TaskDisplayTitle task={task} /></>}
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
                aria-label={`Open parent task ${parentTask.id}: ${String(displayTitle(parentTask).value ?? "")} (${parentTask.status})`}
              >
                <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {parentTask.id}
                </span>
                <span className="min-w-0 break-words font-medium"><TaskDisplayTitle task={parentTask} /></span>
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
              <FieldInput fieldKey="title" value={schemaFields.title} error={fieldErrors.title} onChange={(value) => setSchemaFields((current) => ({ ...current, title: value }))} />
            </div>
          )}
          <SchemaSections
            values={schemaSections}
            other={schemaSectionBaseline.other}
            mode={mode === "preview" ? "view" : "edit"}
            onChange={(id, value) => setSchemaSections((current) => ({ ...current, [id]: value }))}
			onToggleChecklist={handleToggleChecklist}
			checklistBusy={checklistBusy}
			readOnly={isReadOnly}
            onAppendLog={handleAppendLog}
            onLogDraftChange={(id, hasDraft) => setLogDrafts((current) => ({ ...current, [id]: hasDraft }))}
          />

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
                      aria-label={`Open subtask ${subtask.id}: ${String(displayTitle(subtask).value ?? "")} (${subtask.status})`}
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
                          <TaskDisplayTitle task={subtask} />
                        </span>
                      </span>
                      <HierarchyChevron />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {dependencyGraph && dependencyGraph.nodes.length > 1 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <SectionHeader title="Dependency Graph" />
              <DependencyGraphSection graph={dependencyGraph} tasks={availableTasks} />
            </section>
          )}

        </div>

        {/* Sidebar */}
        <div className="md:col-span-1 space-y-4">
          {shownReadiness && (
            <div className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${shownReadiness.isReady ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'}`}>
              <span aria-hidden="true">{shownReadiness.isReady ? '✓' : '⏳'}</span>
              <span>{shownReadiness.isReady ? 'Ready to start' : formatReadinessBlockers(shownReadiness)}</span>
            </div>
          )}
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
            availableTasks={localAvailableTasks}
            milestones={milestoneEntities}
            dateFormat={dateFormat}
            overdueFields={task?.overdue}
          />

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
