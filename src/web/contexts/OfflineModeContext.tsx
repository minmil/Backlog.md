import { createContext, useContext, type ReactNode } from "react";

const OfflineModeContext = createContext<(() => void) | null>(null);

export function OfflineModeProvider({ saveChanges, children }: { saveChanges: () => void; children: ReactNode }) {
	return <OfflineModeContext.Provider value={saveChanges}>{children}</OfflineModeContext.Provider>;
}

export function useOfflineSave(): (() => void) | null {
	return useContext(OfflineModeContext);
}
