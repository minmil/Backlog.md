import { describe, expect, it } from "bun:test";
import { parseFrontmatter } from "../markdown/frontmatter.ts";
import { parseDecision, parseDocument, parseMarkdown, parseTask } from "../markdown/parser.ts";
import { serializeDecision, serializeDocument, serializeTask } from "../markdown/serializer.ts";
import type { Decision, Document, Task } from "../types/index.ts";

describe("Markdown Parser", () => {
	it("preserves owned timestamp scalars without changing opaque YAML dates", () => {
		const value = "2026-10-19T00:00:00Z";
		const flow = `---\n{id: task-1, title: Midnight, created_date: &stamp ${value}, updated_date: *stamp, custom_timestamp: ${value}}\n---`;
		expect(parseTask(flow)).toMatchObject({ createdDate: value, updatedDate: value });
		expect(parseFrontmatter(flow).data.custom_timestamp).toBeInstanceOf(Date);
		const tagged = `---\nid: doc-1\ntitle: Midnight\ncreated_date: !!timestamp ${value}\nupdated_date: '${value}'\n---`;
		expect(parseDocument(tagged)).toMatchObject({ createdDate: value, updatedDate: value });
		expect(parseDecision(`---\nid: decision-1\ndate: ${value}\n---`).date).toBe(value);
		expect(parseTask("---\ncreated_date: 2026-10-19\n---").createdDate).toBe("2026-10-19");
	});
	describe("parseMarkdown", () => {
		it("should parse frontmatter and content", () => {
			const content = `---
title: "Test Task"
status: "To Do"
labels: ["bug", "urgent"]
---

This is the task description.

## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion`;

			const result = parseMarkdown(content);

			expect(result.frontmatter.title).toBe("Test Task");
			expect(result.frontmatter.status).toBe("To Do");
			expect(result.frontmatter.labels).toEqual(["bug", "urgent"]);
			expect(result.content).toContain("This is the task description");
		});

		it("should handle content without frontmatter", () => {
			const content = "Just some markdown content";
			const result = parseMarkdown(content);

			expect(result.frontmatter).toEqual({});
			expect(result.content).toBe("Just some markdown content");
		});

		it("should handle empty content", () => {
			const content = "";
			const result = parseMarkdown(content);

			expect(result.frontmatter).toEqual({});
			expect(result.content).toBe("");
		});
	});

	describe("parseTask", () => {
		it("should parse a task with minimal fields", () => {
			const content = `---
id: task-2
title: "Simple task"
---

Just a basic task.`;

			const task = parseTask(content);

			expect(task.id).toBe("task-2");
			expect(task.title).toBe("Simple task");
			expect(task.status).toBe("");
			expect(task.assignee).toEqual([]);
			expect(task.reporter).toBeUndefined();
			expect(task.labels).toEqual([]);
			expect(task.dependencies).toEqual([]);
			expect(task.acceptanceCriteriaItems).toEqual([]);
			expect(task.parentTaskId).toBeUndefined();
			expect(task.subtasks).toBeUndefined();
		});

		it("should parse unquoted created_date", () => {
			const content = `---
id: task-5
title: "Unquoted"
created_date: 2025-06-08
---`;

			const task = parseTask(content);

			expect(task.createdDate).toBe("2025-06-08");
		});

		it("should parse created_date in short format", () => {
			const content = `---
id: task-6
title: "Short"
created_date: 08-06-25
---`;

			const task = parseTask(content);

			expect(task.createdDate).toBe("2025-06-08");
		});

		it("should preserve frontmatter when title contains dollar-sign digit sequences", () => {
			const content = `---
id: task-112.11
title: 'Build ~$15,000 System (Magnepan 1.7x)'
status: To Do
assignee: []
created_date: "2026-02-10 18:24"
labels:
  - TLR
dependencies: []
priority: high
---

Task body.`;

			const task = parseTask(content);

			expect(task.id).toBe("task-112.11");
			expect(task.title).toBe("Build ~$15,000 System (Magnepan 1.7x)");
			expect(task.status).toBe("To Do");
			expect(task.createdDate).toBe("2026-02-10 18:24");
			expect(task.labels).toEqual(["TLR"]);
			expect(task.priority).toBe("high");
		});

		it("should parse unquoted assignee names starting with @", () => {
			const content = `---
id: task-5
title: "Assignee Test"
assignee: @MrLesk
---

Test task.`;

			const task = parseTask(content);

			expect(task.assignee).toEqual(["@MrLesk"]);
		});

		it("should parse unquoted reporter names starting with @", () => {
			const content = `---
id: task-6
title: "Reporter Test"
assignee: []
reporter: @MrLesk
created_date: 2025-06-08
---

Test task with reporter.`;

			const task = parseTask(content);

			expect(task.reporter).toBe("@MrLesk");
		});

		it("should parse inline assignee lists with unquoted @ handles", () => {
			const content = `---
id: task-7
title: "Inline Assignees"
assignee: [@alice, "@bob"]
status: To Do
created_date: 2025-06-08
---

Test task with inline list.`;

			const task = parseTask(content);

			expect(task.assignee).toEqual(["@alice", "@bob"]);
		});

		it("should escape backslashes in inline @ lists", () => {
			const content = `---
id: task-8
title: "Backslash Inline Assignees"
assignee: [@domain\\\\user]
status: To Do
created_date: 2025-06-08
---

Test task with inline list containing backslash.`;

			const task = parseTask(content);

			expect(task.assignee).toEqual(["@domain\\\\user"]);
		});
	});

	describe("parseDecision", () => {
		it("should parse a decision log", () => {
			const content = `---
id: decision-1
title: "Use TypeScript for backend"
date: "2025-06-03"
status: "accepted"
---

## Context

We need to choose a language for the backend.

## Decision

We will use TypeScript for better type safety.

## Consequences

Better development experience but steeper learning curve.`;

			const decision = parseDecision(content);

			expect(decision.id).toBe("decision-1");
			expect(decision.title).toBe("Use TypeScript for backend");
			expect(decision.status).toBe("accepted");
			expect(decision.context).toBe("We need to choose a language for the backend.");
			expect(decision.decision).toBe("We will use TypeScript for better type safety.");
			expect(decision.consequences).toBe("Better development experience but steeper learning curve.");
		});

		it("should parse decision log with alternatives", () => {
			const content = `---
id: decision-2
title: "Choose database"
date: "2025-06-03"
status: "proposed"
---

## Context

Need a database solution.

## Decision

Use PostgreSQL.

## Consequences

Good performance and reliability.

## Alternatives

Considered MongoDB and MySQL.`;

			const decision = parseDecision(content);

			expect(decision.alternatives).toBe("Considered MongoDB and MySQL.");
		});

		it("should handle missing sections", () => {
			const content = `---
id: decision-3
title: "Minimal decision"
date: "2025-06-03"
status: "proposed"
---

## Context

Some context.`;

			const decision = parseDecision(content);

			expect(decision.context).toBe("Some context.");
			expect(decision.decision).toBe("");
			expect(decision.consequences).toBe("");
			expect(decision.alternatives).toBeUndefined();
		});
	});

	describe("parseDocument", () => {
		it("should parse a document", () => {
			const content = `---
id: doc-1
title: "API Guide"
type: "guide"
created_date: 2025-06-07
tags: [api]
---

Document body.`;

			const doc = parseDocument(content);

			expect(doc.id).toBe("doc-1");
			expect(doc.title).toBe("API Guide");
			expect(doc.type).toBe("guide");
			expect(doc.createdDate).toBe("2025-06-07");
			expect(doc.tags).toEqual(["api"]);
			expect(doc.rawContent).toBe("Document body.");
		});
	});
});

describe("malformed frontmatter", () => {
	// gray-matter caches the file object before parsing, so an uncached second parse used to
	// return empty frontmatter and make an unparseable file look like one with no id.
	it("fails on every parse, not just the first", () => {
		const malformed = "---\nid: doc-2\ntitle: [unterminated\n---\n\nBody\n";

		for (const parse of [parseDocument, parseDecision, parseTask, parseMarkdown]) {
			expect(() => parse(malformed)).toThrow();
		}
	});
});

describe("frontmatter parse cache", () => {
	// gray-matter hands the same data object to every caller that parses identical content, so a
	// caller mutating its own result used to change what later parses of that content returned.
	const content = "---\nid: task-608\ntitle: Cache probe\nlabels: [cache]\n---\n\nBody text\n";

	it("gives each parseFrontmatter call an independent result", () => {
		const first = parseFrontmatter(content);
		first.data.title = "mutated title";
		first.data.injected = true;
		(first.data.labels as string[]).push("mutated label");
		first.content = "mutated content";

		const second = parseFrontmatter(content);
		expect(second.data).toEqual({ id: "task-608", title: "Cache probe", labels: ["cache"] });
		expect(second.content.trim()).toBe("Body text");
	});

	it("parses a task correctly after an earlier parse of the same content was mutated", () => {
		const parsed = parseMarkdown(content);
		parsed.frontmatter.title = "mutated title";
		parsed.frontmatter.status = "Done";
		delete parsed.frontmatter.id;

		const task = parseTask(content);
		expect(task.id).toBe("task-608");
		expect(task.title).toBe("Cache probe");
		expect(task.status).toBe("");
		expect(task.labels).toEqual(["cache"]);
	});
});

describe("Markdown Serializer", () => {
	describe("serializeTask", () => {
		it("should serialize task with subtasks", () => {
			const task: Task = {
				id: "task-parent",
				title: "Parent Task",
				status: "In Progress",
				assignee: [],
				createdDate: "2025-06-03",
				labels: [],
				dependencies: [],
				description: "A parent task with subtasks.",
				subtasks: ["task-parent.1", "task-parent.2"],
			};

			const result = serializeTask(task);

			expect(result).toContain("subtasks:");
			expect(result).toContain("- task-parent.1");
			expect(result).toContain("- task-parent.2");
		});

		it("should serialize task with parent", () => {
			const task: Task = {
				id: "task-1.1",
				title: "Subtask",
				status: "To Do",
				assignee: [],
				createdDate: "2025-06-03",
				labels: [],
				dependencies: [],
				description: "A subtask.",
				parentTaskId: "task-1",
			};

			const result = serializeTask(task);

			expect(result).toContain("parent_task_id: task-1");
		});

		it("should serialize minimal task", () => {
			const task: Task = {
				id: "task-minimal",
				title: "Minimal Task",
				status: "Draft",
				assignee: [],
				createdDate: "2025-06-03",
				labels: [],
				dependencies: [],
				description: "Minimal task.",
			};

			const result = serializeTask(task);

			expect(result).toContain("id: task-minimal");
			expect(result).toContain("title: Minimal Task");
			expect(result).toContain("assignee: []");
			expect(result).not.toContain("reporter:");
			expect(result).not.toContain("updated_date:");
		});
	});

	describe("serializeDecision", () => {
		it("should serialize a decision log correctly", () => {
			const decision: Decision = {
				id: "decision-1",
				title: "Use TypeScript",
				date: "2025-06-03",
				status: "accepted",
				context: "We need type safety",
				decision: "Use TypeScript",
				consequences: "Better DX",
				rawContent: "",
			};

			const result = serializeDecision(decision);

			expect(result).toContain("id: decision-1");
			expect(result).toContain("## Context");
			expect(result).toContain("We need type safety");
			expect(result).toContain("## Decision");
			expect(result).toContain("Use TypeScript");
		});

		it("should serialize decision log with alternatives", () => {
			const decision: Decision = {
				id: "decision-2",
				title: "Database Choice",
				date: "2025-06-03",
				status: "accepted",
				context: "Need database",
				decision: "PostgreSQL",
				consequences: "Good performance",
				alternatives: "Considered MongoDB",
				rawContent: "",
			};

			const result = serializeDecision(decision);

			expect(result).toContain("## Alternatives");
			expect(result).toContain("Considered MongoDB");
		});
	});

	describe("serializeDocument", () => {
		it("should serialize a document correctly", () => {
			const document: Document = {
				id: "doc-1",
				title: "API Documentation",
				type: "specification",
				createdDate: "2025-06-07",
				updatedDate: "2025-06-08",
				rawContent: "This document describes the API endpoints.",
				tags: ["api", "docs"],
			};

			const result = serializeDocument(document);

			expect(result).toContain("id: doc-1");
			expect(result).toContain("title: API Documentation");
			expect(result).toContain("type: specification");
			expect(result).toContain("created_date: '2025-06-07'");
			expect(result).toContain("updated_date: '2025-06-08'");
			expect(result).toContain("tags:");
			expect(result).toContain("- api");
			expect(result).toContain("- docs");
			expect(result).toContain("This document describes the API endpoints.");
		});

		it("should serialize document without optional fields", () => {
			const document: Document = {
				id: "doc-2",
				title: "Simple Doc",
				type: "guide",
				createdDate: "2025-06-07",
				rawContent: "Simple content.",
			};

			const result = serializeDocument(document);

			expect(result).toContain("id: doc-2");
			expect(result).not.toContain("updated_date:");
			expect(result).not.toContain("tags:");
		});
	});
});
