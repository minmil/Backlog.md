import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { useOfflineSave } from './OfflineModeContext.tsx';

interface HealthCheckContextType {
	isOnline: boolean;
	wasDisconnected: boolean;
	retry: () => void;
}

const HealthCheckContext = createContext<HealthCheckContextType | undefined>(undefined);

export function HealthCheckProvider({ children }: { children: ReactNode }) {
	const offline = useOfflineSave();
	if (offline) return <HealthCheckContext.Provider value={{ isOnline: true, wasDisconnected: false, retry: () => {} }}>{children}</HealthCheckContext.Provider>;
	return <LiveHealthCheckProvider>{children}</LiveHealthCheckProvider>;
}

function LiveHealthCheckProvider({ children }: { children: ReactNode }) {
	const healthCheck = useHealthCheck();
	
	return (
		<HealthCheckContext.Provider value={healthCheck}>
			{children}
		</HealthCheckContext.Provider>
	);
}

export function useHealthCheckContext() {
	const context = useContext(HealthCheckContext);
	if (!context) {
		throw new Error('useHealthCheckContext must be used within HealthCheckProvider');
	}
	return context;
}
