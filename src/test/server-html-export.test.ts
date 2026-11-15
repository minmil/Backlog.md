import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { FileSystem } from "../file-system/operations.ts";
import { BacklogServer } from "../server/index.ts";
import { createUniqueTestDir, safeCleanup } from "./test-utils.ts";

describe("browser HTML export", () => {
	let root: string;
	let filesystem: FileSystem;
	let server: BacklogServer;
	let base: string;

	beforeEach(async () => {
		root = createUniqueTestDir("server-html-export");
		await mkdir(root, { recursive: true });
		filesystem = new FileSystem(root);
		await filesystem.ensureBacklogStructure();
		await filesystem.saveConfig({
			projectName: "Export from browser",
			statuses: [],
			labels: [],
			milestones: [],
			dateFormat: "YYYY-MM-DD",
			filesystemOnly: true,
			checkActiveBranches: false,
			remoteOperations: false,
		});
		await filesystem.saveTask({
			id: "TASK-1",
			title: "First version",
			status: "To Do",
			assignee: [],
			createdDate: "2026-01-01",
			labels: [],
			dependencies: [],
		});
		server = new BacklogServer(root);
		await server.start(0, false);
		base = `http://127.0.0.1:${server.getPort()}`;
	});

	afterEach(async () => {
		await server?.stop();
		await safeCleanup(root);
	});

	it("downloads a fresh self-contained snapshot from the current task files", async () => {
		const first = await fetch(`${base}/api/export/html`);
		expect(first.status).toBe(200);
		expect(first.headers.get("content-type")).toContain("text/html");
		expect(first.headers.get("content-disposition")).toBe('attachment; filename="backlog-snapshot.html"');
		const html = await first.text();
		expect(html).toContain('id="backlog-snapshot"');
		expect(html).toContain("First version");
		expect(html).toContain("connect-src 'none'");

		await filesystem.saveTask({
			id: "TASK-2",
			title: "Added later",
			status: "To Do",
			assignee: [],
			createdDate: "2026-01-01",
			labels: [],
			dependencies: [],
		});
		const second = await fetch(`${base}/api/export/html`);
		expect(second.status).toBe(200);
		expect(await second.text()).toContain("Added later");
	});
});
