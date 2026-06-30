const departments = [
    { id: 'strategy', name: 'Strategy', head: 'Strategy Head', icon: '🎯' },
    { id: 'engineering', name: 'Engineering', head: 'CTO', icon: '🏗️' },
    { id: 'growth', name: 'Growth', head: 'CMO', icon: '📈' },
    { id: 'revenue', name: 'Revenue', head: 'CRO', icon: '💰' },
    { id: 'operations', name: 'Operations', head: 'Head of Ops', icon: '⚙️' },
    { id: 'security', name: 'Security', head: 'CISO', icon: '🛡️' },
    { id: 'data', name: 'Data', head: 'CDO', icon: '📊' }
];

const specialists = [
    { name: 'QA Specialist', dept: 'Engineering', key: 'qa' },
    { name: 'Frontend Architect', dept: 'Engineering', key: 'frontend' },
    { name: 'SEO Strategist', dept: 'Growth', key: 'seo' },
    { name: 'CRO Specialist', dept: 'Growth', key: 'cro' },
    { name: 'Finance Analyst', dept: 'Operations', key: 'finance' },
    { name: 'Customer Success', dept: 'Operations', key: 'cs' },
    { name: 'Blue Team', dept: 'Security', key: 'blue' },
    { name: 'Data Scientist', dept: 'Data', key: 'data' }
];

const healthChecks = [
    { name: 'AI Gateway', status: 'pass', detail: 'OpenAI/Anthropic Connected' },
    { name: 'Browser Automation', status: 'pass', detail: 'Playwright 1.44.0 (Chromium)' },
    { name: 'Image Intelligence', status: 'pass', detail: 'rembg python package available' },
    { name: 'Corporate Wiki', status: 'pass', detail: 'Connected to SuperMemory' },
    { name: 'Ubiquity Daemon', status: 'warn', detail: 'Inactive; run zilmate daemon start' },
    { name: 'FFmpeg', status: 'pass', detail: 'Multimedia tools enabled' }
];

const state = {
    activeTab: 'chat',
    isThinking: false,
    traces: [],
    sessionStarted: Date.now()
};

// Selectors
const chatOutput = document.getElementById('chat-output');
const chatInput = document.getElementById('chat-input');
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view-container');
const pageTitle = document.querySelector('.page-title');

function init() {
    navItems.forEach(item => {
        item.addEventListener('click', () => switchTab(item.getAttribute('data-tab')));
    });

    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && chatInput.value.trim()) {
            handleUserMessage(chatInput.value.trim());
            chatInput.value = '';
        }
    });

    switchTab('chat');
    addMessage('bot', "ZilMate Swarm Command Center v3.5 initialized. Ready to orchestrate the Digital Corporation for your task.");
}

function switchTab(tabId) {
    state.activeTab = tabId;

    navItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
    });

    views.forEach(view => {
        if (view.id === `view-${tabId}`) {
            view.classList.remove('hidden');
        } else if (view.id === 'view-other' && !['chat', 'swarm', 'traces', 'doctor'].includes(tabId)) {
            view.classList.remove('hidden');
        } else {
            view.classList.add('hidden');
        }
    });

    const titles = {
        chat: 'Talk to ZilMate',
        swarm: 'Digital Corporation Hierarchy',
        traces: 'Live Swarm Execution Traces',
        memory: 'Corporate Memory Banks',
        wiki: 'Intelligence Blackboard',
        doctor: 'System Health Diagnostics',
        setup: 'System Configuration',
        apps: 'Connected Toolkits'
    };
    pageTitle.innerText = titles[tabId] || 'Command Center';

    if (tabId === 'swarm') renderSwarm();
    if (tabId === 'doctor') renderDoctor();
    if (tabId === 'traces') renderTraces();
}

function handleUserMessage(text) {
    addMessage('user', text);
    simulateOrchestration(text);
}

async function simulateOrchestration(task) {
    addSystemLine(`COO initiating orchestration for: "${task}"`);

    const ctoSpan = addTrace('coo', 'COO', 'Strategy', `Orchestrating task: ${task}`);
    await sleep(800);
    addEvent(ctoSpan, 'tool_call', 'readCorporateContext', 'Reading strategic alignment');

    await sleep(1000);
    const engSpan = addTrace('cto', 'CTO', 'Engineering', 'Analyzing technical requirements');
    addEvent(engSpan, 'tool_call', 'list_files', 'Scanning workspace structure');

    await sleep(1200);
    const qaSpan = addTrace('qa', 'QA Specialist', 'Engineering', 'Verifying interface compliance');
    addEvent(qaSpan, 'tool_call', 'browser_open', 'Opening localhost:3000 for audit');

    await sleep(1500);
    addEvent(engSpan, 'collaboration', 'Handoff to CMO', 'Technical specs ready for growth review');

    await sleep(1000);
    const cmoSpan = addTrace('cmo', 'CMO', 'Growth', 'Drafting market positioning');
    addEvent(cmoSpan, 'wiki_publish', 'Market Insight', 'Competitive gap identified in AI-UX segment');

    await sleep(2000);
    addMessage('bot', "The Swarm has completed the initial analysis. CTO and CMO have aligned on the technical strategy and market positioning. Would you like me to proceed with the implementation phase?");
}

function addMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `msg msg-${role}`;
    msg.innerHTML = `
        <div class="avatar">${role === 'bot' ? 'Z' : 'U'}</div>
        <div class="bubble">${text}</div>
    `;
    chatOutput.appendChild(msg);
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

function addSystemLine(text) {
    const line = document.createElement('div');
    line.className = 'sys-line';
    line.innerText = text;
    chatOutput.appendChild(line);
    chatOutput.scrollTop = chatOutput.scrollHeight;
}

function addTrace(agentKey, name, dept, task) {
    const span = {
        id: Math.random().toString(36).substr(2, 9),
        agentKey,
        name,
        dept,
        task,
        events: [],
        startedAt: Date.now()
    };
    state.traces.unshift(span);
    if (state.activeTab === 'traces') renderTraces();
    return span;
}

function addEvent(span, type, label, detail) {
    span.events.push({ type, label, detail, timestamp: Date.now() });
    if (state.activeTab === 'traces') renderTraces();
}

function renderSwarm() {
    const grid = document.getElementById('swarm-grid');
    grid.innerHTML = '';

    departments.forEach(dept => {
        const card = document.createElement('div');
        card.className = 'card';
        const deptSpecs = specialists.filter(s => s.dept === dept.name);

        card.innerHTML = `
            <div class="card-head">
                <span class="card-title">${dept.icon} ${dept.name}</span>
                <span class="card-status bg-ok">ONLINE</span>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="font-size: 12px; font-weight: 700; color: var(--primary);">HEAD: ${dept.head}</div>
            </div>
            <div class="spec-list">
                ${deptSpecs.map(s => `
                    <div class="spec-item">
                        <div class="spec-info">
                            <span class="spec-name">${s.name}</span>
                        </div>
                        <span class="card-status" style="font-size: 9px; opacity: 0.6;">IDLE</span>
                    </div>
                `).join('')}
                ${deptSpecs.length === 0 ? '<div style="font-size: 11px; color: var(--outline); font-style: italic;">No secondary specialists active</div>' : ''}
            </div>
        `;
        grid.appendChild(card);
    });
}

function renderTraces() {
    const container = document.getElementById('trace-container');
    container.innerHTML = '';

    if (state.traces.length === 0) {
        container.innerHTML = '<div id="no-traces" style="text-align: center; padding: 40px; color: var(--outline);">No active swarm traces. Start a chat to see live orchestration.</div>';
        return;
    }

    state.traces.forEach(span => {
        const node = document.createElement('div');
        node.className = 'trace-node active';
        node.innerHTML = `
            <div class="trace-header">
                <span class="trace-agent">[${span.dept}] ${span.name}</span>
                <span class="trace-time">${new Date(span.startedAt).toLocaleTimeString()}</span>
            </div>
            <div class="trace-task">${span.task}</div>
            <div class="trace-events">
                ${span.events.map(ev => `
                    <div class="event-item ${ev.type === 'tool_call' ? 'tool' : 'wiki'}">
                        <strong>${ev.label}</strong>: ${ev.detail}
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(node);
    });
}

function renderDoctor() {
    const grid = document.getElementById('doctor-grid');
    grid.innerHTML = '';

    healthChecks.forEach(check => {
        const card = document.createElement('div');
        card.className = 'card doctor-card';
        card.style.padding = '16px';
        card.style.display = 'flex';
        card.style.justifyContent = 'space-between';
        card.style.alignItems = 'center';

        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px">
                <span style="font-size: 18px;">${check.status === 'pass' ? '🟢' : '🟡'}</span>
                <div>
                    <div style="font-weight: 700; font-size: 14px;">${check.name}</div>
                    <div style="font-size: 12px; color: var(--on-surface-variant);">${check.detail}</div>
                </div>
            </div>
            <span class="card-status bg-${check.status}">${check.status.toUpperCase()}</span>
        `;
        grid.appendChild(card);
    });
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

window.onload = init;
