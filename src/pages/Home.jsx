import React, { useState } from 'react';
import AgentSidebar from '../components/AgentSidebar';
import AgentSettingsModal from '../components/AgentSettingsModal';
import KanbanBoard from '../components/KanbanBoard';

const Home = () => {
    const [selectedAgent, setSelectedAgent] = useState(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const handleAgentClick = (agent) => {
        setSelectedAgent(agent);
        setIsSettingsOpen(true);
    };

    const handleAgentUpdate = (updatedAgent) => {
        // Force refresh or update local state
        window.location.reload();
    };

    return (
        <div className="flex min-h-[calc(100dvh-10rem)] flex-col gap-6 lg:flex-row">
            <aside className="w-full shrink-0 lg:w-80">
                <AgentSidebar
                    onAgentClick={handleAgentClick}
                    selectedAgentId={selectedAgent?.id}
                />
            </aside>

            <main className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <KanbanBoard />
            </main>

            <AgentSettingsModal
                agent={selectedAgent}
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onUpdate={handleAgentUpdate}
            />
        </div>
    );
};

export default Home;
