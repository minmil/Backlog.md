import { createContext, useContext, type ReactNode } from "react";

const SnapshotModeContext = createContext(false);

export function SnapshotModeProvider({ children }: { children: ReactNode }) {
	return <SnapshotModeContext.Provider value={true}>{children}</SnapshotModeContext.Provider>;
}

export function useSnapshotMode(): boolean {
	return useContext(SnapshotModeContext);
}
