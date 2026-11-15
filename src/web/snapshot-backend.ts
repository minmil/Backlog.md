import { getTaskStatistics } from "../core/statistics.ts";
import { toTaskDetail, withReadiness } from "../core/task-detail.ts";
import type { HtmlSnapshot } from "../export/html-snapshot.ts";
import { publishedTask, renderHtmlSnapshot } from "../export/html-snapshot-render.ts";
import type { LogEntry } from "../markdown/sections.ts";
import { FieldRegistry } from "../schema/field-registry.ts";
import type { BacklogConfig, Decision, Document, Task } from "../types/index.ts";
import { applyStatusOutcome } from "../utils/status-outcome.ts";
import { canonicalTaskId } from "../utils/task-id.ts";
import { createTaskSearchIndex, type TaskSearchIndex } from "../utils/task-search.ts";
import { isTerminalStatus } from "../utils/terminal-status.ts";
import type { SchemaTaskWrite } from "./lib/api.ts";

type OfflineRequestBody = SchemaTaskWrite &
	Partial<Task> &
	Partial<BacklogConfig> & {
		taskId?: string;
		taskIds?: string[];
		targetStatus?: string;
		targetMilestone?: string | null;
		taskHandling?: "clear" | "keep" | "reassign";
		reassignTo?: string;
		filename?: string;
		content?: string;
		path?: string;
	};

function response(value: unknown, status = 200): Response {
	return Response.json(value, { status });
}

/** The browser's existing request surface, backed entirely by the embedded snapshot. */
export class SnapshotBackend {
	private snapshot: HtmlSnapshot;
	private registry: FieldRegistry;
	private searchIndex: TaskSearchIndex | null = null;

	constructor(snapshot: HtmlSnapshot) {
		this.snapshot = snapshot;
		this.registry = new FieldRegistry(snapshot.schema);
	}

	private config(): BacklogConfig {
		return (
			this.snapshot.config ?? {
				projectName: this.snapshot.projectName,
				statuses: this.snapshot.schema.fields.status?.values ?? [],
				labels: [],
				dateFormat: this.snapshot.dateFormat ?? "YYYY-MM-DD",
			}
		);
	}

	tasks(): Task[] {
		const edits = this.snapshot.proposedEdits ?? {};
		const originals = new Set(this.snapshot.tasks.map((task) => canonicalTaskId(task.id)));
		return [
			...this.snapshot.tasks.flatMap((task) => {
				const edit = edits[canonicalTaskId(task.id)];
				return edit?.task === null ? [] : [edit?.task ?? task];
			}),
			...Object.entries(edits).flatMap(([id, edit]) => (!originals.has(id) && edit.task ? [edit.task] : [])),
		];
	}

	private findTask(id: string): Task | undefined {
		return this.tasks().find((task) => canonicalTaskId(task.id) === canonicalTaskId(id));
	}

	private findDraft(id: string): Task | undefined {
		return this.snapshot.drafts?.find((task) => canonicalTaskId(task.id) === canonicalTaskId(id));
	}

	private detail(task: Task) {
		const full = toTaskDetail(task, { tasks: this.tasks(), archivedTasks: [], statuses: this.config().statuses });
		if (full.dependencyGraph.nodes.length <= 100) return full;
		const nodes = full.dependencyGraph.nodes.filter(
			(node) => node.id === task.id || node.dependencyDepth === 1 || node.dependentDepth === 1,
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
	}

	private saveDraft(draft: Task): void {
		const drafts = this.snapshot.drafts ?? [];
		this.snapshot = {
			...this.snapshot,
			drafts: [...drafts.filter((task) => canonicalTaskId(task.id) !== canonicalTaskId(draft.id)), draft],
		};
	}

	private saveTask(task: Task | null, id = task?.id): void {
		if (!id) throw new Error("Missing task ID");
		if (task) applyStatusOutcome(task, this.findTask(id) ?? null, this.snapshot.schema);
		const key = canonicalTaskId(id);
		this.snapshot = {
			...this.snapshot,
			proposedEdits: { ...this.snapshot.proposedEdits, [key]: { task, editedAt: new Date().toISOString() } },
		};
		this.searchIndex = null;
	}

	private applyWrite(task: Task, write: SchemaTaskWrite): Task {
		let next = publishedTask(task, this.snapshot.schema, false);
		if (write.title !== undefined) next = this.registry.setField(next, "title", write.title);
		for (const [key, value] of Object.entries(write.fields ?? {})) {
			next = value === null ? this.registry.clearField(next, key) : this.registry.setField(next, key, value);
		}
		next.sections = { ...next.sections, ...write.sections };
		for (const change of write.checklist ?? []) {
			const items = Array.isArray(next.sections[change.section])
				? [...(next.sections[change.section] as Array<{ index: number; text: string; checked: boolean }>)]
				: [];
			if (change.op === "replace") next.sections[change.section] = change.items ?? [];
			else if (change.op === "add")
				next.sections[change.section] = [
					...items,
					{ index: items.length + 1, text: change.text ?? "", checked: false },
				];
			else if (change.op === "check" || change.op === "uncheck")
				next.sections[change.section] = items.map((item) =>
					item.index === change.index ? { ...item, checked: change.op === "check" } : item,
				);
			else if (change.op === "remove")
				next.sections[change.section] = items
					.filter((item) => item.index !== change.index)
					.map((item, index) => ({ ...item, index: index + 1 }));
		}
		if (write.log) {
			const existing = next.sections[write.log.section];
			next.sections[write.log.section] = [
				...(Array.isArray(existing) ? existing.filter((item): item is LogEntry => "body" in item) : []),
				{
					author: write.log.author ?? "",
					date: write.log.date ?? new Date().toISOString().slice(0, 10),
					createdAt: new Date().toISOString(),
					body: write.log.body,
				},
			];
		}
		return next;
	}

	private newTaskId(draft: boolean): string {
		const prefix = draft ? "DRAFT" : (this.config().prefixes?.task?.toUpperCase() ?? "TASK");
		const highest = [...this.tasks(), ...(this.snapshot.drafts ?? [])].reduce((max, task) => {
			const match = task.id.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
			return Math.max(max, match ? Number(match[1]) : 0);
		}, 0);
		return `${prefix}-${highest + 1}`;
	}

	private search(params: URLSearchParams): unknown[] {
		const tasks = this.tasks();
		const types = params.getAll("type");
		const query = params.get("query")?.trim().toLocaleLowerCase() ?? "";
		if (!this.searchIndex) this.searchIndex = createTaskSearchIndex(tasks, this.registry);
		const matching =
			types.length && !types.includes("task")
				? []
				: this.searchIndex.search({
						query: params.get("query") ?? undefined,
						status: params.getAll("status"),
						excludeStatus: params.getAll("excludeStatus"),
						priority: params.getAll("priority"),
						assignee: params.getAll("assignee"),
						labels: params.getAll("label"),
						modifiedFiles: params.getAll("modifiedFile"),
					});
		const limit = Number(params.get("limit"));
		const ready = withReadiness(matching, { tasks, archivedTasks: [], statuses: this.config().statuses });
		const results: unknown[] = ready.map((task) => ({ type: "task", score: null, task }));
		if (!types.length || types.includes("document"))
			for (const document of this.snapshot.docs ?? [])
				if (!query || `${document.title} ${document.rawContent}`.toLocaleLowerCase().includes(query))
					results.push({ type: "document", score: null, document });
		if (!types.length || types.includes("decision"))
			for (const decision of this.snapshot.decisions ?? [])
				if (!query || `${decision.title} ${decision.rawContent}`.toLocaleLowerCase().includes(query))
					results.push({ type: "decision", score: null, decision });
		return Number.isFinite(limit) && limit > 0 ? results.slice(0, limit) : results;
	}

	private nextRecordId(records: Array<{ id: string }>, prefix: string): string {
		const highest = records.reduce((max, record) => Math.max(max, Number(record.id.match(/\d+$/)?.[0] ?? 0)), 0);
		return `${prefix}-${highest + 1}`;
	}

	async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
		const url = new URL(typeof input === "string" ? input : input.toString(), "http://offline.local");
		const path = url.pathname;
		const method = (init.method ?? "GET").toUpperCase();
		let body: OfflineRequestBody = {};
		try {
			body = init.body ? (JSON.parse(String(init.body)) as OfflineRequestBody) : {};
		} catch {
			body = {};
		}
		try {
			if (path === "/api/status" && method === "GET")
				return response({ initialized: true, projectPath: "Offline snapshot" });
			if (path === "/api/version" && method === "GET") return response({ version: this.snapshot.version ?? "offline" });
			if (path === "/api/schema" && method === "GET") return response(this.snapshot.schema);
			if (path === "/api/statuses" && method === "GET") return response(this.config().statuses);
			if (path === "/api/config" && method === "GET") return response(this.config());
			if (path === "/api/config" && method === "PUT") {
				this.snapshot = {
					...this.snapshot,
					projectName: body.projectName ?? this.snapshot.projectName,
					config: { ...this.config(), ...body },
				};
				return response(this.config());
			}
			if (path === "/api/search" && method === "GET") return response(this.search(url.searchParams));
			if (path === "/api/statistics" && method === "GET") {
				const statistics = getTaskStatistics(
					this.tasks(),
					this.snapshot.drafts ?? [],
					this.config().statuses,
					this.config().priorities,
					this.tasks(),
					this.snapshot.schema.fields.status?.outcomes,
				);
				return response({
					...statistics,
					statusCounts: Object.fromEntries(statistics.statusCounts),
					outcomeCounts: Object.fromEntries(statistics.outcomeCounts),
					priorityCounts: Object.fromEntries(statistics.priorityCounts),
				});
			}
			if (path === "/api/tasks/duplicates" && method === "GET")
				return response({
					groups: [],
					crossBranchFindings: [],
					changes: [],
					references: [],
					referenceScanComplete: true,
					blockedReasons: [],
					repairable: false,
					fingerprint: "",
				});
			if (path === "/api/milestones" && method === "GET") return response(this.snapshot.milestones ?? []);
			if (path === "/api/milestones/archived" && method === "GET")
				return response(this.snapshot.archivedMilestones ?? []);
			if (path === "/api/milestones" && method === "POST") {
				const title = body.title?.trim();
				if (!title) return response({ error: "Milestone title is required" }, 422);
				const highest = [...(this.snapshot.milestones ?? []), ...(this.snapshot.archivedMilestones ?? [])].reduce(
					(max, milestone) => Math.max(max, Number(milestone.id.match(/\d+$/)?.[0] ?? 0)),
					0,
				);
				const milestone = {
					id: `m-${highest + 1}`,
					title,
					description: body.description ?? "",
					dueDate: body.dueDate,
					rawContent: body.description ?? "",
				};
				this.snapshot = { ...this.snapshot, milestones: [...(this.snapshot.milestones ?? []), milestone] };
				return response(milestone);
			}
			const milestoneMatch = path.match(/^\/api\/milestones\/([^/]+)(?:\/(archive))?$/);
			if (milestoneMatch) {
				const id = decodeURIComponent(milestoneMatch[1] ?? "");
				const milestone = (this.snapshot.milestones ?? []).find((item) => item.id.toLowerCase() === id.toLowerCase());
				if (!milestone) return response({ error: "Milestone not found" }, 404);
				if (method === "GET") return response(milestone);
				if (method === "PUT") {
					const changed = {
						...milestone,
						title: body.title ?? milestone.title,
						dueDate: body.dueDate === undefined ? milestone.dueDate : (body.dueDate ?? undefined),
					};
					this.snapshot = {
						...this.snapshot,
						milestones: (this.snapshot.milestones ?? []).map((item) => (item.id === id ? changed : item)),
					};
					return response({ success: true, milestone: changed });
				}
				if (method === "POST" && milestoneMatch[2] === "archive") {
					this.snapshot = {
						...this.snapshot,
						milestones: (this.snapshot.milestones ?? []).filter((item) => item.id !== id),
						archivedMilestones: [...(this.snapshot.archivedMilestones ?? []), milestone],
					};
					return response({ success: true, milestone });
				}
				if (method === "DELETE") {
					if (body.taskHandling !== "keep")
						for (const task of this.tasks())
							if (task.milestone === id)
								this.saveTask({ ...task, milestone: body.taskHandling === "reassign" ? body.reassignTo : undefined });
					this.snapshot = {
						...this.snapshot,
						milestones: (this.snapshot.milestones ?? []).filter((item) => item.id !== id),
					};
					return response({ success: true });
				}
			}
			if (path === "/api/docs" && method === "GET") return response(this.snapshot.docs ?? []);
			if (path === "/api/decisions" && method === "GET") return response(this.snapshot.decisions ?? []);
			if (path === "/api/docs" && method === "POST") {
				const title = body.filename?.trim();
				if (!title) return response({ error: "Document title is required" }, 422);
				const id = this.nextRecordId(this.snapshot.docs ?? [], "doc");
				const document: Document = {
					id,
					title,
					type: "other",
					createdDate: new Date().toISOString().slice(0, 10),
					rawContent: body.content ?? "",
					path: `${body.path ? `${body.path.replace(/\/$/, "")}/` : ""}${id} - ${title}.md`,
				};
				this.snapshot = { ...this.snapshot, docs: [...(this.snapshot.docs ?? []), document] };
				return response(document);
			}
			const docMatch = path.match(/^\/api\/(?:docs|doc)\/(.+?)(?:\/(archive))?$/);
			if (docMatch) {
				const id = decodeURIComponent(docMatch[1] ?? "");
				const document = (this.snapshot.docs ?? []).find(
					(item) => item.id.toLowerCase() === id.toLowerCase() || item.path?.toLowerCase() === id.toLowerCase(),
				);
				if (!document) return response({ error: "Document not found" }, 404);
				if (method === "GET") return response(document);
				if (method === "PUT") {
					const changed = {
						...document,
						title: body.title ?? document.title,
						rawContent: body.content ?? document.rawContent,
						path:
							body.path === undefined
								? document.path
								: `${body.path ? `${body.path.replace(/\/$/, "")}/` : ""}${document.id} - ${body.title ?? document.title}.md`,
						updatedDate: new Date().toISOString().slice(0, 10),
					};
					this.snapshot = {
						...this.snapshot,
						docs: (this.snapshot.docs ?? []).map((item) => (item.id === document.id ? changed : item)),
					};
					return response(changed);
				}
				if (method === "POST" && docMatch[2] === "archive") {
					this.snapshot = {
						...this.snapshot,
						docs: (this.snapshot.docs ?? []).filter((item) => item.id !== document.id),
					};
					return response({ success: true });
				}
			}
			if (path === "/api/decisions" && method === "POST") {
				const title = body.title?.trim();
				if (!title) return response({ error: "Decision title is required" }, 422);
				const decision: Decision = {
					id: this.nextRecordId(this.snapshot.decisions ?? [], "decision"),
					title,
					date: new Date().toISOString().slice(0, 10),
					status: "proposed",
					context: "",
					decision: "",
					consequences: "",
					rawContent: "",
				};
				this.snapshot = { ...this.snapshot, decisions: [...(this.snapshot.decisions ?? []), decision] };
				return response(decision);
			}
			const decisionMatch = path.match(/^\/api\/(?:decisions|decision)\/([^/]+)(?:\/(archive))?$/);
			if (decisionMatch) {
				const id = decodeURIComponent(decisionMatch[1] ?? "");
				const decision = (this.snapshot.decisions ?? []).find((item) => item.id.toLowerCase() === id.toLowerCase());
				if (!decision) return response({ error: "Decision not found" }, 404);
				if (method === "GET") return response(decision);
				if (method === "PUT") {
					const changed = { ...decision, rawContent: String(init.body ?? "") };
					this.snapshot = {
						...this.snapshot,
						decisions: (this.snapshot.decisions ?? []).map((item) => (item.id === decision.id ? changed : item)),
					};
					return response({ success: true });
				}
				if (method === "POST" && decisionMatch[2] === "archive") {
					this.snapshot = {
						...this.snapshot,
						decisions: (this.snapshot.decisions ?? []).filter((item) => item.id !== decision.id),
					};
					return response({ success: true });
				}
			}
			if (path === "/api/drafts" && method === "GET") return response(this.snapshot.drafts ?? []);
			const promoteMatch = path.match(/^\/api\/drafts\/([^/]+)\/promote$/);
			if (promoteMatch && method === "POST") {
				const id = decodeURIComponent(promoteMatch[1] ?? "");
				const draft = this.findDraft(id);
				if (!draft) return response({ error: "Draft not found" }, 404);
				this.snapshot = {
					...this.snapshot,
					drafts: (this.snapshot.drafts ?? []).filter((task) => canonicalTaskId(task.id) !== canonicalTaskId(id)),
				};
				const task = {
					...draft,
					id: this.newTaskId(false),
					status: this.config().defaultStatus ?? this.config().statuses[0] ?? "To Do",
				};
				this.saveTask(task);
				return response(task);
			}
			if (path === "/api/tasks" && method === "GET") return response(this.tasks());
			if (path === "/api/task" && method === "GET") return response({ error: "Task ID required" }, 400);
			if (path.startsWith("/api/task/") && method === "GET") {
				const id = decodeURIComponent(path.slice("/api/task/".length));
				const task = this.findTask(id) ?? this.findDraft(id);
				return task ? response(this.detail(task)) : response({ error: "Task not found" }, 404);
			}
			if (path === "/api/tasks" && method === "POST") {
				const draft = body?.fields?.status === "Draft";
				const task: Task = {
					id: this.newTaskId(draft),
					title: "Untitled",
					status: draft ? "Draft" : (this.config().defaultStatus ?? this.config().statuses[0] ?? "To Do"),
					assignee: [],
					labels: [],
					dependencies: [],
					createdDate: new Date().toISOString().slice(0, 10),
					sections: {},
					fieldValues: {},
					source: "local",
				};
				const created = this.applyWrite(task, body ?? {});
				if (draft) this.saveDraft(created);
				else this.saveTask(created);
				return response(created);
			}
			if (path === "/api/tasks/cleanup" && method === "GET") {
				const age = Number(url.searchParams.get("age") ?? 0);
				const cutoff = Date.now() - age * 86400_000;
				const tasks = this.tasks().filter(
					(task) =>
						isTerminalStatus(task.status, this.config().statuses) &&
						new Date(task.updatedDate ?? task.createdDate).getTime() <= cutoff,
				);
				return response({
					count: tasks.length,
					tasks: tasks.map(({ id, title, updatedDate, createdDate }) => ({ id, title, updatedDate, createdDate })),
				});
			}
			if (path === "/api/tasks/cleanup/execute" && method === "POST") {
				let movedCount = 0;
				for (const id of body.taskIds ?? []) {
					const task = this.findTask(id);
					if (!task || !isTerminalStatus(task.status, this.config().statuses)) continue;
					this.saveTask(null, id);
					movedCount++;
				}
				return response({
					success: true,
					movedCount,
					totalCount: body.taskIds?.length ?? 0,
					message: `${movedCount} tasks archived`,
				});
			}
			if (path === "/api/tasks/reorder" && method === "POST") {
				const task = this.findTask(body.taskId ?? "");
				if (!task) return response({ error: "Task not found" }, 404);
				const changed = {
					...task,
					status: body.targetStatus ?? task.status,
					...(body.targetMilestone !== undefined ? { milestone: body.targetMilestone || undefined } : {}),
				};
				this.saveTask(changed);
				return response({ success: true, task: changed, changedTasks: [changed] });
			}
			if (path === "/api/tasks/move" && method === "POST") {
				const changedTasks: Task[] = [];
				for (const id of body.taskIds ?? []) {
					const task = this.findTask(id);
					if (!task) continue;
					const changed = {
						...task,
						status: body.targetStatus ?? task.status,
						...(body.targetMilestone !== undefined ? { milestone: body.targetMilestone || undefined } : {}),
					};
					this.saveTask(changed);
					changedTasks.push(changed);
				}
				return response({ success: true, tasks: changedTasks, changedTasks, failures: [] });
			}
			const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(?:\/(archive|demote))?$/);
			if (taskMatch) {
				const id = decodeURIComponent(taskMatch[1] ?? "");
				const draft = this.findDraft(id);
				const task = this.findTask(id) ?? draft;
				if (!task) return response({ error: "Task not found" }, 404);
				if (method === "POST" && taskMatch[2] === "archive") {
					this.saveTask(null, id);
					return response({ success: true });
				}
				if (method === "POST" && taskMatch[2] === "demote") {
					this.saveTask(null, id);
					this.saveDraft({ ...task, id: this.newTaskId(true), status: "Draft" });
					return response({ success: true, cleanedTaskIds: [] });
				}
				if (method === "PUT") {
					const changed = publishedTask({ ...task, ...body }, this.snapshot.schema, false);
					if (draft) this.saveDraft(changed);
					else this.saveTask(changed);
					return response(changed);
				}
				if (method === "PATCH") {
					const changed = this.applyWrite(task, body ?? {});
					if (draft) this.saveDraft(changed);
					else this.saveTask(changed);
					return response(changed);
				}
			}
			return response({ error: `Offline operation unavailable: ${method} ${path}` }, 404);
		} catch (error) {
			return response({ error: error instanceof Error ? error.message : String(error) }, 422);
		}
	}

	saveChanges(): void {
		const javascript = document.querySelector<HTMLScriptElement>("script:not([type])")?.textContent;
		const css = document.querySelector<HTMLStyleElement>("style")?.textContent;
		if (!javascript || !css) throw new Error("Embedded viewer assets are missing");
		const html = renderHtmlSnapshot(this.snapshot, javascript, css);
		const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "backlog-reviewed.html";
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 60_000);
	}
}
