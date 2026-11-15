import React from "react";
import { createRoot } from "react-dom/client";
import type { HtmlSnapshot } from "../export/html-snapshot.ts";
import App from "./App.tsx";
import { SchemaProvider } from "./components/schema/SchemaProvider.tsx";
import { HealthCheckProvider } from "./contexts/HealthCheckContext.tsx";
import { OfflineModeProvider } from "./contexts/OfflineModeContext.tsx";
import { SnapshotBackend } from "./snapshot-backend.ts";
import "./styles/source.css";

const element = document.getElementById("backlog-snapshot");
if (!element?.textContent) throw new Error("Missing Backlog snapshot data");
const snapshot = JSON.parse(element.textContent) as HtmlSnapshot;
if (snapshot.formatVersion !== 2) throw new Error(`Unsupported Backlog snapshot version ${snapshot.formatVersion}`);

const backend = new SnapshotBackend(snapshot);
window.fetch = backend.fetch.bind(backend) as typeof fetch;
try {
	window.localStorage.getItem("backlog-theme");
} catch {
	const values = new Map<string, string>();
	Object.defineProperty(window, "localStorage", { configurable: true, value: {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => { values.set(key, String(value)); },
		removeItem: (key: string) => { values.delete(key); },
		clear: () => values.clear(),
		key: (index: number) => [...values.keys()][index] ?? null,
		get length() { return values.size; },
	} });
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing Backlog snapshot mount point");
createRoot(root).render(
	<React.StrictMode>
		<OfflineModeProvider saveChanges={() => backend.saveChanges()}>
			<HealthCheckProvider>
				<SchemaProvider initialSchema={snapshot.schema}>
					<App />
				</SchemaProvider>
			</HealthCheckProvider>
		</OfflineModeProvider>
	</React.StrictMode>,
);
