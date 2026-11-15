import React from 'react';
import { BranchIndexingIndicator } from './BranchIndexingIndicator';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './schema/LanguageToggle.tsx';
import { useOfflineSave } from '../contexts/OfflineModeContext.tsx';

interface NavigationProps {
    projectName: string;
    loadingMessage?: string | null;
}

const Navigation: React.FC<NavigationProps> = ({projectName, loadingMessage}) => {
    const saveChanges = useOfflineSave();
    return (
        <nav className="relative px-8 h-18 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-colors duration-200">
            <div className="h-full flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{projectName || 'Loading...'}</h1>
                    <span className="text-sm text-gray-500 dark:text-gray-400">powered by</span>
                    <a
                        href="https://backlog.md"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300 hover:underline transition-colors duration-200"
                    >
                        Backlog.md
                    </a>
                </div>
                <div className="flex items-center gap-3">
                    <BranchIndexingIndicator message={loadingMessage} />
                    {saveChanges ? <button
                        type="button"
                        onClick={saveChanges}
                        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-stone-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                    >Save changes</button> : <a
                        href="/api/export/html"
                        download="backlog-snapshot.html"
                        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-stone-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                        Export HTML
                    </a>}
                    <LanguageToggle />
                    <ThemeToggle />
                </div>
            </div>
        </nav>
    );
};

export default Navigation;
