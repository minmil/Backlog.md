import { afterEach, describe, expect, it } from "bun:test";
import { ApiClient, ApiError, NetworkError } from "../web/lib/api.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("Web critical reads", () => {
	it("does not repeat a failed task detail request", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			throw new Error("connection failed");
		}) as unknown as typeof globalThis.fetch;

		const client = new ApiClient({ retries: 1, timeout: 100 });
		const error = await client.fetchTask("TASK-10").then(
			() => null,
			(reason: unknown) => reason,
		);

		expect(calls).toBe(1);
		expect(error).toBeInstanceOf(NetworkError);
	});

	it("does not repeat a failed search request", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			return Response.json({ error: "Search failed" }, { status: 500 });
		}) as unknown as typeof globalThis.fetch;

		const client = new ApiClient({ retries: 1, timeout: 100 });
		const error = await client.search().then(
			() => null,
			(reason: unknown) => reason,
		);

		expect(calls).toBe(1);
		expect(error).toBeInstanceOf(ApiError);
	});
});
