import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir } from "node:fs/promises";
import { $ } from "bun";
import { Core } from "../index.ts";
import { getTestCliPath } from "./test-cli.ts";
import { createUniqueTestDir, initializeFilesystemTestProject, safeCleanup } from "./test-utils.ts";

let TEST_DIR: string;

describe("CLI task milestone assignment", () => {
	const cliPath = getTestCliPath();

	beforeEach(async () => {
		TEST_DIR = createUniqueTestDir("test-cli-task-milestone");
		await mkdir(TEST_DIR, { recursive: true });

		const core = new Core(TEST_DIR);
		await initializeFilesystemTestProject(core, "CLI Milestone Assignment Project");
	});

	afterEach(async () => {
		await safeCleanup(TEST_DIR);
	});

	it("shows milestone create and edit flags in help output", async () => {
		const createHelp = await $`bun ${cliPath} task create --help`.cwd(TEST_DIR).quiet();
		const editHelp = await $`bun ${cliPath} task edit --help`.cwd(TEST_DIR).quiet();

		expect(createHelp.stdout.toString()).toContain("-m, --milestone <milestone>");
		expect(editHelp.stdout.toString()).toContain("-m, --milestone <milestone>");
		expect(editHelp.stdout.toString()).toContain("--clear-milestone");
	});
});
