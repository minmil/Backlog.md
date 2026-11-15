import { useMemo, useState, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { HtmlSnapshot } from "../export/html-snapshot.ts";
import { renderHtmlSnapshot } from "../export/html-snapshot-render.ts";
import { toTaskDetail } from "../core/task-detail.ts";
import { canonicalTaskId } from "../utils/task-id.ts";
import type { Task } from "../types/index.ts";
import TaskCard from "./components/TaskCard.tsx";
import TaskDetailsModal from "./components/TaskDetailsModal.tsx";
import FieldValue from "./components/schema/FieldValue.tsx";
import { SchemaProvider, useSchema } from "./components/schema/SchemaProvider.tsx";
import TaskDisplayTitle from "./components/schema/TaskDisplayTitle.tsx";
import { DisplayLanguageProvider, useDisplayLanguage } from "./components/schema/DisplayLanguageContext.tsx";
import { TaskIdIndexProvider, useTaskIdIndex } from "./contexts/TaskIdIndexContext.tsx";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext.tsx";
import { SnapshotModeProvider } from "./contexts/SnapshotModeContext.tsx";
import "./styles/source.css";

const element = document.getElementById("backlog-snapshot");
if (!element?.textContent) throw new Error("Missing Backlog snapshot data");
const initialSnapshot = JSON.parse(element.textContent) as HtmlSnapshot;
if (initialSnapshot.formatVersion !== 1) throw new Error(`Unsupported Backlog snapshot version ${initialSnapshot.formatVersion}`);

function effectiveTasks(snapshot: HtmlSnapshot): { tasks: Task[]; archivedTasks: Task[] } {
	const apply = (tasks: Task[]) => tasks.map((task) => snapshot.proposedEdits?.[canonicalTaskId(task.id)]?.task ?? task);
	return { tasks: apply(snapshot.tasks), archivedTasks: apply(snapshot.archivedTasks) };
}

function downloadHtmlCopy(snapshot: HtmlSnapshot): void {
	const javascript = document.querySelector<HTMLScriptElement>("script:not([type])")?.textContent;
	const css = document.querySelector<HTMLStyleElement>("style")?.textContent;
	if (!javascript || !css) throw new Error("Embedded viewer assets are missing.");
	const html = renderHtmlSnapshot(snapshot, javascript, css);
	const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = "backlog-reviewed.html";
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const EMPTY_UPDATE = () => {};
const PAGE_SIZE = 100;

function valueOf(task: Task, key: string, registry: ReturnType<typeof useSchema>["registry"]): unknown {
	return registry.getField(task, key);
}

function compareValues(a: unknown, b: unknown): number {
	const left = Array.isArray(a) ? a.join(", ") : String(a ?? "");
	const right = Array.isArray(b) ? b.join(", ") : String(b ?? "");
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function SnapshotViewer({ snapshot, onProposeEdit, onSaveCopy }: { snapshot: HtmlSnapshot; onProposeEdit: (task: Task) => void; onSaveCopy: () => void }) {
	const allTasks = useMemo(() => [...snapshot.tasks, ...snapshot.archivedTasks], [snapshot]);
	const { schema, registry } = useSchema();
	const { theme, toggleTheme } = useTheme();
	const { lang, setLang, displayLanguages } = useDisplayLanguage();
	const taskIndex = useTaskIdIndex();
	const navigate = useNavigate();
	const location = useLocation();
	const view = location.pathname.startsWith("/tasks") ? "list" : "board";
	const routeId = location.pathname.match(/^\/(?:tasks|board)\/([^/]+)/)?.[1];
	const selected = routeId ? taskIndex.get(canonicalTaskId(decodeURIComponent(routeId))) : undefined;
	const [query, setQuery] = useState("");
	const [filterKey, setFilterKey] = useState("status");
	const [filterValue, setFilterValue] = useState("");
	const [sortKey, setSortKey] = useState("id");
	const [descending, setDescending] = useState(false);
	const [showArchive, setShowArchive] = useState(false);
	const [shown, setShown] = useState(PAGE_SIZE);
	const [saveError, setSaveError] = useState("");
	const statuses = [
		...new Set([...(schema.fields.status?.values ?? []), ...snapshot.tasks.map((task) => task.status)]),
	];
	const filterKeys = [...new Set(["status", ...schema.ui.board.filters, ...schema.ui.task_list.filters, ...Object.keys(schema.fields)])].filter(
		(key) => schema.fields[key] && !schema.fields[key]?.hidden,
	);
	const sortKeys = [...new Set(["id", "title", ...schema.ui.task_list.columns, ...Object.keys(schema.fields)])].filter(
		(key) => key === "id" || (schema.fields[key] && !schema.fields[key]?.hidden),
	);
	const candidates = showArchive && view === "list" ? allTasks : snapshot.tasks;
	const searchIndex = useMemo(
		() => new Map(allTasks.map((task) => [task, JSON.stringify(task).toLocaleLowerCase()])),
		[allTasks],
	);
	const filterOptions = useMemo(() => {
		const values = new Set<string>();
		for (const task of candidates) {
			const value = valueOf(task, filterKey, registry);
			for (const item of Array.isArray(value) ? value : [value]) {
				if (item !== undefined && item !== null && item !== "") values.add(String(item));
			}
		}
		return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	}, [candidates, filterKey, registry]);
	const visible = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		return candidates
			.filter((task) => {
				if (needle && !searchIndex.get(task)?.includes(needle)) return false;
				if (!filterValue) return true;
				const value = valueOf(task, filterKey, registry);
				return Array.isArray(value)
					? value.some((item) => String(item) === filterValue)
					: String(value ?? "") === filterValue;
			})
			.sort(
				(a, b) => (descending ? -1 : 1) * compareValues(valueOf(a, sortKey, registry), valueOf(b, sortKey, registry)),
			);
	}, [candidates, query, filterKey, filterValue, sortKey, descending, registry, searchIndex]);
	const displayed = visible.slice(0, shown);
	const detail = useMemo(() => {
		if (!selected) return undefined;
		const full = toTaskDetail(selected, { tasks: snapshot.tasks, archivedTasks: snapshot.archivedTasks, statuses });
		// A large chain can make a nested React tree thousands of levels deep. Direct links remain
		// navigable, while the full corpus is still used to resolve their identities and readiness.
		const nodes = full.dependencyGraph.nodes.filter(
			(node) => node.id === selected.id || node.dependencyDepth === 1 || node.dependentDepth === 1,
		);
		const ids = new Set(nodes.map((node) => node.id));
		return {
			...full,
			dependencyGraph: {
				...full.dependencyGraph,
				nodes,
				edges: full.dependencyGraph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
			},
		};
	}, [selected, snapshot]);
	const basePath = view === "board" ? "/board" : "/tasks";
	const openTask = (task: Task) => navigate(`${basePath}/${encodeURIComponent(task.id)}`);
	const onLinkClick = (event: MouseEvent<HTMLElement>) => {
		const anchor = (event.target as HTMLElement).closest("a[href]");
		if (!anchor) return;
		const href = anchor.getAttribute("href") ?? "";
		if (!/^\/tasks\/[A-Za-z0-9._-]+$/.test(href)) return;
		event.preventDefault();
		const id = href.slice("/tasks/".length);
		const target = taskIndex.get(canonicalTaskId(id));
		if (target) openTask(target);
	};
	const listColumns = [...new Set(["id", "title", "status", ...schema.ui.task_list.columns])].filter(
		(key) => key === "id" || (schema.fields[key] && !schema.fields[key]?.hidden),
	);
	return (
		<div
			className="min-h-screen bg-stone-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100"
			onClickCapture={onLinkClick}
		>
			<header className="border-b border-stone-200 bg-white px-4 py-4 dark:border-gray-700 dark:bg-gray-900">
				<div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3">
					<div className="mr-auto min-w-0">
						<h1 className="truncate text-xl font-semibold">{snapshot.projectName}</h1>
						<p className="text-xs text-gray-600 dark:text-gray-400">
							Offline review copy · {new Date(snapshot.generatedAt).toLocaleString()} · {snapshot.taskCount} tasks · {Object.keys(snapshot.proposedEdits ?? {}).length} proposed {Object.keys(snapshot.proposedEdits ?? {}).length === 1 ? "edit" : "edits"}
						</p>
					</div>
					<nav aria-label="Views" className="flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-gray-800">
						<button
							type="button"
							aria-current={view === "board" ? "page" : undefined}
							onClick={() => {
								setShown(PAGE_SIZE);
								navigate("/board");
							}}
							className={`rounded-md px-3 py-1.5 text-sm ${view === "board" ? "bg-white font-semibold shadow dark:bg-gray-700" : ""}`}
						>
							Board
						</button>
						<button
							type="button"
							aria-current={view === "list" ? "page" : undefined}
							onClick={() => {
								setShown(PAGE_SIZE);
								navigate("/tasks");
							}}
							className={`rounded-md px-3 py-1.5 text-sm ${view === "list" ? "bg-white font-semibold shadow dark:bg-gray-700" : ""}`}
						>
							List
						</button>
					</nav>
					<button type="button" onClick={() => { try { onSaveCopy(); setSaveError(""); } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); } }} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm dark:border-gray-600">Save HTML copy</button>
					{displayLanguages.length > 1 ? (
						<select
							aria-label="Display language"
							value={lang}
							onChange={(event) => setLang(event.target.value)}
							className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
						>
							{displayLanguages.map((code) => (
								<option key={code} value={code}>
									{code.toUpperCase()}
								</option>
							))}
						</select>
					) : null}
					<button
						type="button"
						onClick={toggleTheme}
						className="rounded-md border border-stone-300 px-3 py-1.5 text-sm dark:border-gray-600"
					>
						{theme === "dark" ? "Light" : "Dark"} theme
					</button>
				</div>
			</header>
			{saveError ? <p role="alert" className="mx-auto max-w-screen-2xl px-4 py-2 text-red-600">{saveError}</p> : null}
			<main className="mx-auto max-w-screen-2xl px-4 py-5">
				<div className="mb-4 flex flex-wrap items-end gap-3">
					<label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
						Search
						<input
							aria-label="Search tasks"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setShown(PAGE_SIZE);
							}}
							placeholder="Search tasks and content"
							className="rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						/>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						Filter field
						<select
							aria-label="Filter field"
							value={filterKey}
							onChange={(event) => {
								setFilterKey(event.target.value);
								setFilterValue("");
								setShown(PAGE_SIZE);
							}}
							className="rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						>
							{filterKeys.map((key) => (
								<option key={key} value={key}>
									{schema.fields[key]?.label ?? key}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						Filter value
						<select
							aria-label="Filter value"
							value={filterValue}
							onChange={(event) => {
								setFilterValue(event.target.value);
								setShown(PAGE_SIZE);
							}}
							className="rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						>
							<option value="">All</option>
							{filterOptions.map((item) => (
								<option key={item} value={item}>
									{item}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1 text-sm">
						Sort by
						<select
							aria-label="Sort by"
							value={sortKey}
							onChange={(event) => setSortKey(event.target.value)}
							className="rounded-md border border-stone-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
						>
							{sortKeys.map((key) => (
								<option key={key} value={key}>
									{schema.fields[key]?.label ?? key}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						aria-label="Reverse sort"
						onClick={() => setDescending((current) => !current)}
						className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-gray-600"
					>
						{descending ? "Descending" : "Ascending"}
					</button>
					{view === "list" && snapshot.archivedTaskCount > 0 ? (
						<label className="flex items-center gap-2 pb-2 text-sm">
							<input
								type="checkbox"
								checked={showArchive}
								onChange={(event) => {
									setShowArchive(event.target.checked);
									setShown(PAGE_SIZE);
								}}
							/>
							Include archive
						</label>
					) : null}
				</div>
				<p className="mb-3 text-xs text-gray-600 dark:text-gray-400" role="status">
					{visible.length} matching tasks
				</p>
				{view === "board" ? (
					<div className="flex gap-4 overflow-x-auto pb-4" data-snapshot-board>
						{statuses.map((status) => {
							const column = displayed.filter((task) => task.status === status);
							return (
								<section
									key={status}
									className="w-72 shrink-0 rounded-lg bg-stone-100 p-3 dark:bg-gray-800"
									aria-label={status}
								>
									<h2 className="mb-3 flex justify-between font-semibold">
										<span>{status}</span>
										<span>{visible.filter((task) => task.status === status).length}</span>
									</h2>
									{column.map((task) => (
										<TaskCard
											key={task.id}
											task={task}
											onUpdate={EMPTY_UPDATE}
											onEdit={openTask}
											dateFormat={snapshot.dateFormat}
										/>
									))}
								</section>
							);
						})}
					</div>
				) : (
					<div
						className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:border-gray-700 dark:bg-gray-900"
						data-snapshot-list
					>
						<table className="w-full border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-stone-200 dark:border-gray-700">
									{listColumns.map((key) => (
										<th key={key} className="whitespace-nowrap px-3 py-2">
											{schema.fields[key]?.label ?? key}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{displayed.map((task) => (
									<tr
										key={task.id}
										className="border-b border-stone-100 hover:bg-stone-50 dark:border-gray-800 dark:hover:bg-gray-800"
									>
										{listColumns.map((key) => (
											<td key={key} className="px-3 py-2 align-top">
												{key === "title" ? (
													<button
														type="button"
														onClick={() => openTask(task)}
														className="text-left font-medium text-blue-700 hover:underline dark:text-blue-300"
													>
														<TaskDisplayTitle task={task} />
													</button>
												) : key === "id" ? (
													<button
														type="button"
														onClick={() => openTask(task)}
														className="font-mono text-blue-700 hover:underline dark:text-blue-300"
													>
														{task.id}
													</button>
												) : (
													<FieldValue
														fieldKey={key}
														value={valueOf(task, key, registry) as never}
														variant="cell"
														dateFormat={snapshot.dateFormat}
													/>
												)}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{visible.length > shown ? (
					<button
						type="button"
						onClick={() => setShown((current) => current + PAGE_SIZE)}
						className="mt-4 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
					>
						Show more ({visible.length - shown} remaining)
					</button>
				) : null}
			</main>
			<TaskDetailsModal
				key={selected?.id ?? "closed"}
				task={detail}
				isOpen={Boolean(detail)}
				onClose={() => navigate(basePath)}
				availableTasks={allTasks}
				availableStatuses={statuses}
				onNavigateToTask={openTask}
				dateFormat={snapshot.dateFormat}
				onProposeEdit={onProposeEdit}
			/>
		</div>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Backlog snapshot mount point");
function SnapshotApp() {
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	const effective = useMemo(() => effectiveTasks(snapshot), [snapshot]);
	const displayedSnapshot = useMemo(() => ({ ...snapshot, ...effective }), [snapshot, effective]);
	const allTasks = useMemo(() => [...effective.tasks, ...effective.archivedTasks], [effective]);
	const propose = (task: Task) => setSnapshot((current) => ({
		...current,
		proposedEdits: { ...current.proposedEdits, [canonicalTaskId(task.id)]: { task, editedAt: new Date().toISOString() } },
	}));
	return <TaskIdIndexProvider tasks={allTasks}><SnapshotViewer snapshot={displayedSnapshot} onProposeEdit={propose} onSaveCopy={() => downloadHtmlCopy(snapshot)} /></TaskIdIndexProvider>;
}

createRoot(root).render(
	<SnapshotModeProvider>
		<MemoryRouter initialEntries={["/board"]}>
			<SchemaProvider initialSchema={initialSnapshot.schema}>
				<DisplayLanguageProvider>
					<ThemeProvider>
						<SnapshotApp />
					</ThemeProvider>
				</DisplayLanguageProvider>
			</SchemaProvider>
		</MemoryRouter>
	</SnapshotModeProvider>,
);
