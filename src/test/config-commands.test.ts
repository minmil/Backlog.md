import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";
import { type PromptRunner, runAdvancedConfigWizard } from "../commands/advanced-config-wizard.ts";
import { configureAdvancedSettings } from "../commands/configure-advanced-settings.ts";
import { Core } from "../core/backlog.ts";
import { getTestCliPath } from "./test-cli.ts";
import {
	createUniqueTestDir,
	initializeFilesystemTestProject,
	safeCleanup,
	updateTestTaskSchema,
} from "./test-utils.ts";

let TEST_DIR: string;
const CLI_PATH = getTestCliPath();

describe("Config commands", () => {
	let core: Core;

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-config-commands");
		await mkdir(TEST_DIR, { recursive: true });

		// Configure git for tests - required for CI
		await $`git init`.cwd(TEST_DIR).quiet();

		core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "Test Config Project");
	});

	function createPromptStub(sequence: Array<Record<string, unknown>>): PromptRunner {
		const stub: PromptRunner = async () => {
			const response = sequence.shift();
			if (!response) {
				throw new Error("Advanced config wizard requested an unexpected prompt.");
			}
			return response;
		};
		return stub;
	}

	it("configureAdvancedSettings keeps defaults when no changes requested", async () => {
		const promptStub = createPromptStub([
			{ installCompletions: false },
			{ checkActiveBranches: true },
			{ remoteOperations: true },
			{ activeBranchDays: 30 },
			{ bypassGitHooks: false },
			{ autoCommit: false },
			{ enableZeroPadding: false },
			{ editor: "" },
			{ configureWebUI: false },
			{ installClaudeAgent: false },
		]);

		const { mergedConfig, installClaudeAgent, installShellCompletions } = await configureAdvancedSettings(core, {
			promptImpl: promptStub,
		});

		expect(installClaudeAgent).toBe(false);
		expect(installShellCompletions).toBe(false);
		expect(mergedConfig.checkActiveBranches).toBe(true);
		expect(mergedConfig.remoteOperations).toBe(true);
		expect(mergedConfig.activeBranchDays).toBe(30);
		expect(mergedConfig.bypassGitHooks).toBe(false);
		expect(mergedConfig.autoCommit).toBe(false);
		expect(mergedConfig.zeroPaddedIds).toBeUndefined();
		expect(mergedConfig.defaultEditor).toBeUndefined();
		expect(mergedConfig.definitionOfDone).toBeUndefined();
		expect(mergedConfig.defaultPort).toBe(6420);
		expect(mergedConfig.autoOpenBrowser).toBe(true);

		const reloadedConfig = await core.filesystem.loadConfig();
		expect(reloadedConfig?.definitionOfDone).toBeUndefined();
		expect(reloadedConfig?.defaultPort).toBe(6420);
		expect(reloadedConfig?.autoOpenBrowser).toBe(true);
	});

	it("configureAdvancedSettings applies wizard selections", async () => {
		const promptStub = createPromptStub([
			{ installCompletions: true },
			{ checkActiveBranches: true },
			{ remoteOperations: false },
			{ activeBranchDays: 14 },
			{ bypassGitHooks: true },
			{ autoCommit: true },
			{ enableZeroPadding: true },
			{ paddingWidth: 4 },
			{ editor: "backlog-test-editor" },
			{ configureWebUI: true },
			{ defaultPort: 7007, autoOpenBrowser: false },
			{ installClaudeAgent: true },
		]);

		const { mergedConfig, installClaudeAgent, installShellCompletions } = await configureAdvancedSettings(core, {
			promptImpl: promptStub,
			isEditorAvailable: async (editor) => editor === "backlog-test-editor",
		});

		expect(installClaudeAgent).toBe(true);
		expect(installShellCompletions).toBe(true);
		expect(mergedConfig.checkActiveBranches).toBe(true);
		expect(mergedConfig.remoteOperations).toBe(false);
		expect(mergedConfig.activeBranchDays).toBe(14);
		expect(mergedConfig.bypassGitHooks).toBe(true);
		expect(mergedConfig.autoCommit).toBe(true);
		expect(mergedConfig.zeroPaddedIds).toBe(4);
		expect(mergedConfig.defaultEditor).toBe("backlog-test-editor");
		expect(mergedConfig.definitionOfDone).toBeUndefined();
		expect(mergedConfig.defaultPort).toBe(7007);
		expect(mergedConfig.autoOpenBrowser).toBe(false);

		const reloadedConfig = await core.filesystem.loadConfig();
		expect(reloadedConfig?.zeroPaddedIds).toBe(4);
		expect(reloadedConfig?.defaultEditor).toBe("backlog-test-editor");
		expect(reloadedConfig?.definitionOfDone).toBeUndefined();
		expect(reloadedConfig?.defaultPort).toBe(7007);
		expect(reloadedConfig?.autoOpenBrowser).toBe(false);
		expect(reloadedConfig?.bypassGitHooks).toBe(true);
		expect(reloadedConfig?.autoCommit).toBe(true);
	});

	describe("advanced wizard editor prompt", () => {
		let originalEditor: string | undefined;

		// Answers every prompt with the value it starts from, as pressing Enter would.
		const acceptStartingValues: PromptRunner = async (question) => {
			const questions = Array.isArray(question) ? question : [question];
			return Object.fromEntries(questions.map(({ name, initial }) => [name, initial]));
		};

		beforeEach(() => {
			originalEditor = process.env.EDITOR;
			process.env.EDITOR = "backlog-env-editor";
		});

		afterEach(() => {
			if (originalEditor === undefined) {
				delete process.env.EDITOR;
			} else {
				process.env.EDITOR = originalEditor;
			}
		});

		it("leaves an existing project without an editor when every prompt is accepted", async () => {
			const { mergedConfig } = await configureAdvancedSettings(core, {
				promptImpl: acceptStartingValues,
				isEditorAvailable: async () => true,
			});

			expect(mergedConfig.defaultEditor).toBeUndefined();
			expect(await Bun.file(core.filesystem.configFilePath).text()).not.toContain("default_editor");
		});

		it("still offers the environment's editor to a project that has no config yet", async () => {
			const { config } = await runAdvancedConfigWizard({
				existingConfig: null,
				cancelMessage: "Aborting initialization.",
				promptImpl: acceptStartingValues,
				isEditorAvailable: async () => true,
			});

			expect(config.defaultEditor).toBe("backlog-env-editor");
		});
	});

	it("exposes config list/get/set subcommands", async () => {
		const listOutput = await $`bun ${CLI_PATH} config list`.cwd(TEST_DIR).text();
		expect(listOutput).toContain("Configuration:");

		await $`bun ${CLI_PATH} config set defaultPort 7001`.cwd(TEST_DIR).quiet();

		const portOutput = await $`bun ${CLI_PATH} config get defaultPort`.cwd(TEST_DIR).text();
		expect(portOutput.trim()).toBe("7001");
	});

	it("round-trips hideEmptyColumns through config get/set/list", async () => {
		const defaultGet = await $`bun ${CLI_PATH} config get hideEmptyColumns`.cwd(TEST_DIR).text();
		expect(defaultGet.trim()).toBe("false");

		await $`bun ${CLI_PATH} config set hideEmptyColumns true`.cwd(TEST_DIR).quiet();

		const afterSet = await $`bun ${CLI_PATH} config get hideEmptyColumns`.cwd(TEST_DIR).text();
		expect(afterSet.trim()).toBe("true");

		const listOutput = await $`bun ${CLI_PATH} config list`.cwd(TEST_DIR).text();
		expect(listOutput).toContain("hideEmptyColumns: true");
	});

	it("omits moved list keys from config list", async () => {
		const output = await $`bun ${CLI_PATH} config list`.cwd(TEST_DIR).text();
		for (const key of ["statuses", "labels", "types", "priorities", "projects", "defaultAssignee"]) {
			expect(output).not.toContain(`${key}:`);
		}
	});

	it("rejects config get for keys now owned by the task schema", async () => {
		for (const key of ["statuses", "labels", "types", "priorities", "projects", "defaultAssignee"]) {
			const result = await $`bun ${CLI_PATH} config get ${key}`.cwd(TEST_DIR).nothrow().quiet();
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("task-schema.yml");
		}
	});

	it("rejects config set for keys now owned by the task schema", async () => {
		for (const key of ["statuses", "labels", "types", "priorities", "projects", "defaultAssignee"]) {
			const result = await $`bun ${CLI_PATH} config set ${key} example`.cwd(TEST_DIR).nothrow().quiet();
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("task-schema.yml");
		}
	});

	it("gives a consistent available-key list for unknown config keys", async () => {
		const unknownGet = await $`bun ${CLI_PATH} config get nosuchkey`.cwd(TEST_DIR).nothrow().quiet();
		const unknownSet = await $`bun ${CLI_PATH} config set nosuchkey value`.cwd(TEST_DIR).nothrow().quiet();
		const getKeys = unknownGet.stderr.toString().match(/Available keys: .*/)?.[0];
		const setKeys = unknownSet.stderr.toString().match(/Available keys: .*/)?.[0];
		expect(getKeys).toBeDefined();
		expect(setKeys).toEqual(getKeys);
		expect(getKeys).toContain("task-schema.yml");
	});

	it("surfaces milestones in config get/list from milestone files", async () => {
		await core.filesystem.createMilestone("Release 1");

		const milestonesOutput = await $`bun ${CLI_PATH} config get milestones`.cwd(TEST_DIR).text();
		expect(milestonesOutput.trim()).toBe("m-0");

		const listOutput = await $`bun ${CLI_PATH} config list`.cwd(TEST_DIR).text();
		expect(listOutput).toContain("milestones: [m-0]");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("should preserve other config values when setting defaultEditor", async () => {
		let config = await core.filesystem.loadConfig();
		const originalProjectName = config?.projectName;
		const originalStatuses = config ? [...config.statuses] : [];

		// Set defaultEditor
		if (config) {
			config.defaultEditor = "code";
			await core.filesystem.saveConfig(config);
		}

		// Reload and verify other values are preserved
		config = await core.filesystem.loadConfig();
		expect(config?.defaultEditor).toBe("code");
		expect(config?.projectName).toBe(originalProjectName ?? "");
		expect(config?.statuses).toEqual(originalStatuses);
	});

	for (const key of [
		"statuses",
		"default_status",
		"labels",
		"types",
		"priorities",
		"projects",
		"default_assignee",
		"default_reporter",
		"definition_of_done",
	]) {
		it(`rejects moved config key ${key} and points to task-schema.yml`, async () => {
			const configPath = core.filesystem.configFilePath;
			const original = await Bun.file(configPath).text();
			await Bun.write(configPath, `${original}${key}: []\n`);
			expect(() => new Core(TEST_DIR).filesystem.taskSchema).toThrow(key);
			expect(() => new Core(TEST_DIR).filesystem.taskSchema).toThrow("task-schema.yml");
			expect(await Bun.file(configPath).text()).toBe(`${original}${key}: []\n`);
		});
	}

	it("gets the default assignee from the schema users block", async () => {
		await updateTestTaskSchema(core.filesystem, (schema) => {
			schema.users = [{ handle: "@alice", name: "Alice", default: true }];
		});
		const reloaded = new Core(TEST_DIR);
		const created = await reloaded.createTaskFromInput({ title: "Default owner" }, false);
		expect(created.task.assignee).toEqual(["@alice"]);
		const get = await $`bun ${CLI_PATH} config get defaultAssignee`.cwd(TEST_DIR).nothrow().quiet();
		expect(get.exitCode).not.toBe(0);
		expect(get.stderr.toString()).toContain("task-schema.yml");
	});

	it("lets an explicit assignee override the schema default user", async () => {
		await updateTestTaskSchema(core.filesystem, (schema) => {
			schema.users = [
				{ handle: "@alice", name: "Alice", default: true },
				{ handle: "@bob", name: "Bob" },
			];
		});
		const reloaded = new Core(TEST_DIR);
		const created = await reloaded.createTaskFromInput({ title: "Explicit owner", assignee: ["@bob"] }, false);
		expect(created.task.assignee).toEqual(["@bob"]);
	});

	it("rejects a moved config key before changing a draft or milestone", async () => {
		await $`bun ${CLI_PATH} draft create "Draftling" --plain`.cwd(TEST_DIR).quiet();
		await core.filesystem.createMilestone("Mile");
		const configPath = core.filesystem.configFilePath;
		const original = await Bun.file(configPath).text();
		await Bun.write(configPath, `${original}statuses: [To Do, Done]\n`);
		for (const args of [
			["draft", "promote", "draft-1"],
			["milestone", "add", "Second"],
		]) {
			const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).nothrow().quiet();
			expect(result.exitCode).not.toBe(0);
			expect(result.stderr.toString()).toContain("task-schema.yml");
		}
		expect(await Bun.file(configPath).text()).toBe(`${original}statuses: [To Do, Done]\n`);
	});

	it("clears defaultEditor via config set with an explicitly empty value", async () => {
		// An empty value means "no editor": it must be stored, not rejected as an invalid executable
		const config = await core.filesystem.loadConfig();
		if (!config) throw new Error("Config not loaded");
		config.defaultEditor = "code --wait";
		await core.filesystem.saveConfig(config);
		expect((await core.filesystem.loadConfig())?.defaultEditor).toBe("code --wait");

		const cleared = await $`bun ${CLI_PATH} config set defaultEditor ${""}`.cwd(TEST_DIR).nothrow().quiet();
		expect(cleared.exitCode).toBe(0);

		core.filesystem.invalidateConfigCache();
		const reloaded = await core.filesystem.loadConfig();
		expect(reloaded?.defaultEditor).toBeUndefined();
	});

	it("honors an explicitly empty --default-editor flag during init instead of discarding it", async () => {
		// With EDITOR set as a sentinel, a discarded empty flag would fall back to the environment value
		const initDir = createUniqueTestDir("test-config-commands-init");
		await mkdir(initDir, { recursive: true });
		await $`git init`.cwd(initDir).quiet();

		const env = { ...process.env, EDITOR: "backlog-sentinel-editor", VISUAL: "backlog-sentinel-editor" };
		const result =
			await $`bun ${CLI_PATH} init "Editorless Project" --defaults --default-editor ${""} --integration-mode none`
				.cwd(initDir)
				.env(env)
				.nothrow()
				.quiet();
		expect(result.exitCode).toBe(0);

		const initCore = new Core(initDir);
		const config = await initCore.filesystem.loadConfig();
		expect(config?.defaultEditor).toBeUndefined();

		await safeCleanup(initDir);
	});

	it("clears a configured editor when re-initializing with an explicitly empty --default-editor", async () => {
		const initDir = createUniqueTestDir("test-config-commands-reinit");
		await mkdir(initDir, { recursive: true });
		await $`git init`.cwd(initDir).quiet();

		// First init without the flag: the EDITOR env fallback must still apply
		const env = { ...process.env, EDITOR: "backlog-sentinel-editor", VISUAL: "backlog-sentinel-editor" };
		const initial = await $`bun ${CLI_PATH} init "Editor Project" --defaults --integration-mode none`
			.cwd(initDir)
			.env(env)
			.nothrow()
			.quiet();
		expect(initial.exitCode).toBe(0);

		const initCore = new Core(initDir);
		expect((await initCore.filesystem.loadConfig())?.defaultEditor).toBe("backlog-sentinel-editor");

		// Re-init with an explicitly empty flag: clears the editor instead of keeping the existing value
		const reinit =
			await $`bun ${CLI_PATH} init "Editor Project" --defaults --default-editor ${""} --integration-mode none`
				.cwd(initDir)
				.env(env)
				.nothrow()
				.quiet();
		expect(reinit.exitCode).toBe(0);
		initCore.filesystem.invalidateConfigCache();
		expect((await initCore.filesystem.loadConfig())?.defaultEditor).toBeUndefined();

		await safeCleanup(initDir);
	});
});

describe("defaultEditor when init runs again", () => {
	let projectDir: string;

	beforeEach(async () => {
		projectDir = createUniqueTestDir("test-config-commands-reinit");
		await mkdir(projectDir, { recursive: true });
		await $`git init`.cwd(projectDir).quiet();
	});

	afterEach(async () => {
		await safeCleanup(projectDir);
	});

	const configPath = () => join(projectDir, "backlog", "config.yml");

	async function runInit(editorEnv: Record<string, string>) {
		// Only the editor variables a test names reach the CLI, never the developer's own.
		const { EDITOR: _editor, VISUAL: _visual, ...env } = process.env;
		const result = await $`bun ${CLI_PATH} init "Editor Project" --defaults --integration-mode none`
			.cwd(projectDir)
			.env({ ...env, ...editorEnv })
			.nothrow()
			.quiet();
		expect(result.exitCode).toBe(0);
	}

	async function editorLinesInConfigFile(): Promise<string[]> {
		const content = await Bun.file(configPath()).text();
		return content.split("\n").filter((line) => line.startsWith("default_editor"));
	}

	async function configGetEditor(): Promise<string> {
		const result = await $`bun ${CLI_PATH} config get defaultEditor`.cwd(projectDir).nothrow().quiet();
		return result.stdout.toString().trim();
	}

	for (const variable of ["EDITOR", "VISUAL"]) {
		it(`does not write ${variable} into the config after the editor was cleared`, async () => {
			await runInit({ EDITOR: "backlog-first-editor" });
			expect(await editorLinesInConfigFile()).toEqual(['default_editor: "backlog-first-editor"']);

			const cleared = await $`bun ${CLI_PATH} config set defaultEditor ${""}`.cwd(projectDir).nothrow().quiet();
			expect(cleared.exitCode).toBe(0);
			expect(await editorLinesInConfigFile()).toEqual([]);

			await runInit({ [variable]: "backlog-second-editor" });
			expect(await editorLinesInConfigFile()).toEqual([]);
			expect(await configGetEditor()).toBe("defaultEditor is not set");
		});
	}

	it("does not write EDITOR over a hand-written empty default_editor", async () => {
		await runInit({});
		await appendFile(configPath(), 'default_editor: ""\n');

		await runInit({ EDITOR: "backlog-second-editor" });
		expect(await Bun.file(configPath()).text()).not.toContain("backlog-second-editor");
		expect(await configGetEditor()).toBe("defaultEditor is not set");
	});

	it("keeps the editor a first init took from VISUAL when init runs again", async () => {
		await runInit({ VISUAL: "backlog-first-editor" });
		expect(await editorLinesInConfigFile()).toEqual(['default_editor: "backlog-first-editor"']);

		await runInit({ EDITOR: "backlog-second-editor", VISUAL: "backlog-second-editor" });
		expect(await editorLinesInConfigFile()).toEqual(['default_editor: "backlog-first-editor"']);
		expect(await configGetEditor()).toBe("backlog-first-editor");
	});
});
