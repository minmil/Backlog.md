import type { ViewerBundle } from "./viewer-bundle.ts";

declare const __SNAPSHOT_VIEWER_JS__: string | undefined;
declare const __SNAPSHOT_VIEWER_CSS__: string | undefined;

/** The compiled CLI uses its embedded assets; source mode bundles only when export is requested. */
export async function getViewerBundle(): Promise<ViewerBundle> {
	if (typeof __SNAPSHOT_VIEWER_JS__ !== "undefined" && typeof __SNAPSHOT_VIEWER_CSS__ !== "undefined") {
		return { javascript: __SNAPSHOT_VIEWER_JS__, css: __SNAPSHOT_VIEWER_CSS__ };
	}
	return await (await import("./viewer-bundle.ts")).bundleSnapshotViewer();
}
