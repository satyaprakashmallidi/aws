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
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
            {/* Left Sidebar - Agent List */}
            <aside className="col-span-3">
                <AgentSidebar
                    onAgentClick={handleAgentClick}
                    selectedAgentId={selectedAgent?.id}
                />
            </aside>

            {/* Center - Kanban Board */}
            <main className="col-span-9 bg-white rounded-lg shadow h-full overflow-hidden">
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
