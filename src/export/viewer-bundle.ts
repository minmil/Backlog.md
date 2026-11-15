import { resolve } from "node:path";
import tailwind from "bun-plugin-tailwind";

const noMermaid: Bun.BunPlugin = {
	name: "snapshot-no-mermaid",
	setup(build) {
		build.onResolve({ filter: /mermaid$/ }, (args) => {
			if (args.importer.endsWith("MermaidMarkdown.tsx"))
				return { path: "snapshot-mermaid", namespace: "snapshot-mermaid" };
			return undefined;
		});
		build.onLoad({ filter: /.*/, namespace: "snapshot-mermaid" }, () => ({
			contents: "export async function renderMermaidIn() {}",
			loader: "js",
		}));
	},
};

export interface ViewerBundle {
	javascript: string;
	css: string;
}

/** Used by source-tree CLI runs and by scripts/build.ts before compiling the distributable CLI. */
export async function bundleSnapshotViewer(): Promise<ViewerBundle> {
	const entrypoint = resolve(import.meta.dir, "../web/snapshot-main.tsx");
	const result = await Bun.build({
		entrypoints: [entrypoint],
		target: "browser",
		format: "iife",
		splitting: false,
		minify: true,
		plugins: [noMermaid, tailwind],
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		throw: false,
	});
	if (!result.success) throw new Error(`Cannot build snapshot viewer: ${result.logs.join("\n")}`);
	const scripts = result.outputs.filter((output) => output.type.startsWith("text/javascript"));
	const styles = result.outputs.filter((output) => output.type.startsWith("text/css"));
	const script = scripts[0];
	const style = styles[0];
	if (!script || !style || scripts.length !== 1 || styles.length !== 1 || result.outputs.length !== 2) {
		throw new Error(
			`Snapshot viewer must bundle into one script and one stylesheet; got ${result.outputs.map((output) => `${output.path} (${output.type})`).join(", ")}`,
		);
	}
	return { javascript: await script.text(), css: await style.text() };
}
