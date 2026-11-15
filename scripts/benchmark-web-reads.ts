import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { FileSystem } from "../src/file-system/operations.ts";
import { serializeTask } from "../src/markdown/serializer.ts";
import { BacklogServer } from "../src/server/index.ts";
import type { Task } from "../src/types/index.ts";

const count = Number(process.argv[2] ?? 100);
const mode = process.argv[3] ?? "untracked";
const iterations = Number(process.argv[4] ?? 12);
if (!["untracked", "committed", "filesystem", "branches"].includes(mode) || !Number.isInteger(count) || count < 1)
	throw new Error(
		"Usage: bun scripts/benchmark-web-reads.ts [count] [untracked|committed|filesystem|branches] [iterations]",
	);

async function git(root: string, ...args: string[]) {
	const child = Bun.spawn(["git", ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Benchmark",
			GIT_AUTHOR_EMAIL: "benchmark@local.test",
			GIT_COMMITTER_NAME: "Benchmark",
			GIT_COMMITTER_EMAIL: "benchmark@local.test",
			GIT_CONFIG_NOSYSTEM: "1",
		},
	});
	const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	if (code !== 0) throw new Error(`git ${args.join(" ")}: ${error}`);
}

const root = await mkdtemp(join(tmpdir(), "backlog-web-reads-"));
let server: BacklogServer | undefined;
try {
	const fs = new FileSystem(root);
	await fs.ensureBacklogStructure();
	await fs.saveConfig({
		projectName: "Web read benchmark",
		statuses: [],
		labels: [],
		milestones: [],
		dateFormat: "YYYY-MM-DD",
		autoCommit: false,
		remoteOperations: false,
		checkActiveBranches: mode === "branches",
		filesystemOnly: mode === "filesystem",
	});
	const schemaPath = join(fs.backlogDir, "task-schema.yml");
	await writeFile(
		schemaPath,
		(await readFile(join(import.meta.dir, "../src/schema/default-task-schema.yml"), "utf8")).replace(
			"fields:\n",
			"fields:\n  custom_score: {type: number, label: Score}\n",
		),
	);
	if (mode !== "filesystem") await git(root, "init", "-b", "main");
	for (let i = 1; i <= count; i++) {
		const task: Task = {
			id: `TASK-${i}`,
			title: `Task ${i} 日本語`,
			status: i % 3 === 0 ? "In Progress" : "To Do",
			assignee: ["@benchmark"],
			createdDate: "2026-01-01",
			updatedDate: "2026-01-02",
			labels: ["benchmark"],
			priority: "medium",
			dependencies: i > 1 ? [`TASK-${i - 1}`] : [],
			description: `Description for task ${i}. 日本語 content. `.repeat(8),
			fieldValues: { custom_score: i % 10 },
			sections: {
				description: `Description for task ${i}. 日本語 content. `.repeat(8),
				acceptance: [{ index: 1, text: "Review the result", checked: i % 3 === 0 }],
				log: [
					{
						author: "@benchmark",
						date: "2026-01-02",
						createdAt: "2026-01-02T09:00:00Z",
						body: "Created the task. 日本語",
					},
				],
			},
			ordinal: i * 1000,
		};
		await writeFile(join(fs.tasksDir, `task-${i} - Benchmark.md`), serializeTask(task, "", undefined, fs.taskSchema));
	}
	if (mode === "committed" || mode === "branches") {
		await git(root, "add", ".");
		await git(root, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-m", "Benchmark");
		if (mode === "branches") {
			await git(root, "switch", "-c", "benchmark/other");
			const branchTask: Task = {
				id: `TASK-${count + 1}`,
				title: "Branch-only task 日本語",
				status: "In Progress",
				assignee: [],
				createdDate: "2026-01-01",
				labels: [],
				dependencies: ["TASK-1"],
			};
			await writeFile(
				join(fs.tasksDir, `task-${count + 1} - Branch-only.md`),
				serializeTask(branchTask, "", undefined, fs.taskSchema),
			);
			await git(root, "add", ".");
			await git(root, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-m", "Branch-only task");
			await git(root, "switch", "main");
		}
	}
	const tracePath = join(root, "git-trace.jsonl");
	process.env.GIT_TRACE2_EVENT = tracePath;
	server = new BacklogServer(root);
	const core = (
		server as unknown as { core: { filesystem: FileSystem; refreshTasksForTaskRead: () => Promise<boolean> } }
	).core;
	let scans = 0;
	let archivedScans = 0;
	let refreshes = 0;
	const listTasks = core.filesystem.listTasks.bind(core.filesystem);
	const listArchivedTasks = core.filesystem.listArchivedTasks.bind(core.filesystem);
	const refresh = core.refreshTasksForTaskRead.bind(core);
	core.filesystem.listTasks = async (...args: Parameters<typeof listTasks>) => {
		scans++;
		return listTasks(...args);
	};
	core.filesystem.listArchivedTasks = async (...args: Parameters<typeof listArchivedTasks>) => {
		archivedScans++;
		return listArchivedTasks(...args);
	};
	core.refreshTasksForTaskRead = async (...args: Parameters<typeof refresh>) => {
		refreshes++;
		return refresh(...args);
	};
	const started = performance.now();
	const cpuStarted = process.cpuUsage();
	await server.start(0, false);
	const startupMs = performance.now() - started;
	const port = server.getPort();
	if (!port) throw new Error("Server did not start");
	const base = `http://127.0.0.1:${port}`;
	const sample = async (path: string) => {
		const begin = performance.now();
		const response = await fetch(`${base}${path}`);
		if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${await response.text()}`);
		await response.arrayBuffer();
		return performance.now() - begin;
	};
	const cold = await sample("/api/search");
	const workingCopyWatchers = (
		await (core as unknown as import("../src/core/backlog.ts").Core).getContentStore()
	).hasWorkingCopyWatchers();
	const operation = async (path: string) => {
		const before = { scans, archivedScans, refreshes };
		const times = [];
		for (let i = 0; i < iterations; i++) times.push(await sample(path));
		times.sort((a, b) => a - b);
		return {
			medianMs: times[Math.floor(times.length / 2)],
			p95Ms: times[Math.ceil(times.length * 0.95) - 1],
			maxMs: times.at(-1),
			scans: scans - before.scans,
			archivedScans: archivedScans - before.archivedScans,
			refreshes: refreshes - before.refreshes,
		};
	};
	const search = await operation("/api/search");
	const detail = await operation("/api/task/TASK-1");
	const different = await operation("/api/task/TASK-2");
	const concurrentStart = performance.now();
	await Promise.all([sample("/api/search"), sample("/api/task/TASK-1")]);
	const concurrentMs = performance.now() - concurrentStart;
	const cpu = process.cpuUsage(cpuStarted);
	const trace = (await readFile(tracePath, "utf8").catch(() => ""))
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as { event: string; sid: string; t_abs?: number }];
			} catch {
				return [];
			}
		});
	const gitExits = trace.filter((event) => event.event === "exit");
	const gitStarts = new Map(
		trace.filter((event) => event.event === "start").map((event) => [event.sid, event.t_abs ?? 0]),
	);
	console.log(
		JSON.stringify({
			...(process.env.BACKLOG_BENCHMARK_KEEP === "1" ? { projectRoot: root } : {}),
			count,
			mode,
			iterations,
			startupMs,
			coldSearchMs: cold,
			workingCopyWatchers,
			search,
			detail,
			different,
			concurrentMs,
			cpuMs: (cpu.user + cpu.system) / 1000,
			gitProcesses: gitExits.length,
			gitDurationMs: gitExits.reduce(
				(sum, event) => sum + ((event.t_abs ?? 0) - (gitStarts.get(event.sid) ?? 0)) * 1000,
				0,
			),
			heapMb: process.memoryUsage().heapUsed / 1048576,
			rssMb: process.memoryUsage().rss / 1048576,
		}),
	);
} finally {
	delete process.env.GIT_TRACE2_EVENT;
	await server?.stop();
	if (process.env.BACKLOG_BENCHMARK_KEEP !== "1") await rm(root, { recursive: true, force: true });
}
