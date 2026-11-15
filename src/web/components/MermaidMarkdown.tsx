import { useEffect, useMemo, useRef } from "react";
import MDEditor from "@uiw/react-md-editor";
import { useTaskIdIndex } from "../contexts/TaskIdIndexContext";
import { renderMermaidIn } from "../utils/mermaid";
import { createTaskIdLinkPlugin } from "../utils/task-id-links";
import { useSnapshotMode } from "../contexts/SnapshotModeContext.tsx";

interface Props {
	source: string;
}

/**
 * Remark plugin that switches HTML syntax off in the Markdown parser, so tag-like text such
 * as `<repo>` is always plain text and the preview shows it as written, in prose and in code alike.
 *
 * This is also what keeps HTML in Markdown files inert. The preview library turns any HTML
 * the parser reports into real elements, and its `skipHtml` option does not switch that step
 * off, so `<script>`, `<img onerror=...>` and type strings such as `Result<List<MenuItem>>`
 * must never be reported as HTML. Autolinks (`<https://example.com>`, `<user@example.com>`)
 * are separate Markdown syntax and still link.
 * Mermaid diagrams are drawn from code blocks afterwards; `renderMermaidIn` keeps HTML out of those.
 */
function treatHtmlAsText(this: { data(): object }): void {
	// The processor's shared settings, where the Markdown parser looks up its extensions.
	const settings: { micromarkExtensions?: unknown[] } = this.data();
	settings.micromarkExtensions ??= [];
	// "htmlFlow" is block-level HTML and "htmlText" is inline HTML in micromark, the parser behind remark.
	settings.micromarkExtensions.push({ disable: { null: ["htmlFlow", "htmlText"] } });
}

function keepHashLinksInCurrentRoute(url: string, key: string): string {
	if (key !== "href" || !url.startsWith("#") || typeof window === "undefined") {
		return url;
	}

	return `${window.location.pathname}${window.location.search}${url}`;
}

function snapshotImagesAsText() {
	type Node = { type: string; alt?: string; children?: Node[] };
	const visit = (node: Node) => {
		if (!node.children) return;
		node.children = node.children.map((child) => {
			if (child.type === "image" || child.type === "imageReference") {
				return { type: "text", value: child.alt ? `[Image: ${child.alt}]` : "[Image omitted]" } as Node;
			}
			visit(child);
			return child;
		});
	};
	return visit;
}

export default function MermaidMarkdown({ source }: Props) {
	const ref = useRef<HTMLDivElement | null>(null);
	const snapshotMode = useSnapshotMode();
	const taskIdIndex = useTaskIdIndex();
	const remarkPlugins = useMemo(
		() => [treatHtmlAsText, createTaskIdLinkPlugin(taskIdIndex), ...(snapshotMode ? [snapshotImagesAsText] : [])],
		[taskIdIndex, snapshotMode],
	);

	useEffect(() => {
		// The snapshot has no runtime asset loading. Mermaid code remains visible as a code block.
		if (snapshotMode) return;
		if (!ref.current) return;

		// Render mermaid diagrams after the markdown has been rendered
		// Use requestAnimationFrame to ensure MDEditor has finished rendering
		const frameId = requestAnimationFrame(() => {
			if (ref.current) {
				void renderMermaidIn(ref.current);
			}
		});

		return () => cancelAnimationFrame(frameId);
	}, [source, snapshotMode]);
	const urlTransform = (url: string, key: string): string => {
		if (!snapshotMode) return keepHashLinksInCurrentRoute(url, key);
		if (key === "src") return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(url) ? url : "";
		if (key !== "href") return "";
		if (/^\/tasks\/[A-Za-z0-9._-]+$/.test(url) || url.startsWith("#")) return url;
		try {
			const parsed = new URL(url);
			return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? url : "";
		} catch {
			return "";
		}
	};

	return (
		<div ref={ref} className="wmde-markdown">
			<MDEditor.Markdown source={source} urlTransform={urlTransform} remarkPlugins={remarkPlugins} />
		</div>
	);
}
