const state = {
    currentTab: 'chat',
    logs: [],
    specialists: [
        { name: 'QA', dept: 'Engineering', status: 'idle' },
        { name: 'DevLead', dept: 'Engineering', status: 'active' },
        { name: 'SEO', dept: 'Growth', status: 'active' },
        { name: 'Finance', dept: 'Operations', status: 'idle' }
    ],
    checks: [
        { name: 'AI Gateway', status: 'pass', detail: 'Authenticated' },
        { name: 'Browser Automation', status: 'pass', detail: 'Playwright 1.44.0' },
        { name: 'Image Intelligence', status: 'pass', detail: 'rembg available' },
        { name: 'Ubiquity Daemon', status: 'warn', detail: 'Inactive' }
    ]
};

const terminalBody = document.querySelector('.terminal-body');
const inputField = document.querySelector('.input-field');
const pageTitle = document.querySelector('.page-title');
const navItems = document.querySelectorAll('.nav-item');

function init() {
    inputField.addEventListener('keypress', handleInput);
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    // Initial welcome
    addMessage('bot', 'Welcome back, Commander. All systems operational. How can I assist your business operations today?');
}

function switchTab(tab) {
    state.currentTab = tab;

    // Update Nav
    navItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tab);
    });

    // Update Title
    const labels = {
        chat: 'Talk to ZilMate',
        swarm: 'Swarm Dashboard',
        jobs: 'Background Jobs',
        memory: 'Digital Memory',
        wiki: 'Corporate Wiki',
        apps: 'Connected Apps',
        doctor: 'System Doctor',
        setup: 'Configuration'
    };
    pageTitle.innerText = labels[tab];

    // Render view
    renderView(tab);
}

function renderView(tab) {
    terminalBody.innerHTML = '';

    if (tab === 'chat') {
        addMessage('system', 'Context: Interactive Chat Session');
        addMessage('bot', 'Ready for your commands.');
    } else if (tab === 'swarm') {
        addMessage('system', 'Context: Digital Corporation Swarm Status');
        const grid = document.createElement('div');
        grid.className = 'card-grid';

        const depts = ['Strategy', 'Engineering', 'Growth', 'Revenue', 'Operations', 'Security', 'Data'];
        depts.forEach(dept => {
            const card = document.createElement('div');
            card.className = 'card';
            const specCount = state.specialists.filter(s => s.dept === dept).length;
            card.innerHTML = `
                <div class="card-h">
                    <span class="card-title">${dept.toUpperCase()}</span>
                    <span class="status-indicator ${specCount > 0 ? 'status-ok' : 'status-warn'}">
                        ${specCount > 0 ? 'Active' : 'Idle'}
                    </span>
                </div>
                <div style="font-size: 12px; color: var(--on-surface-variant)">
                    Specialists: ${specCount > 0 ? state.specialists.filter(s => s.dept === dept).map(s => s.name).join(', ') : 'None active'}
                </div>
            `;
            grid.appendChild(card);
        });
        terminalBody.appendChild(grid);
    } else if (tab === 'doctor') {
        addMessage('system', 'Context: System Health Diagnostics');
        const list = document.createElement('div');
        list.style.display = 'flex';
        list.style.flexDirection = 'column';
        list.style.gap = '12px';

        state.checks.forEach(check => {
            const item = document.createElement('div');
            item.className = 'card';
            item.style.padding = '16px';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px">
                    <span style="color: ${check.status === 'pass' ? 'var(--success)' : 'var(--warning)'}">${check.status === 'pass' ? '✔' : '⚠'}</span>
                    <div>
                        <div style="font-weight: 600; font-size: 14px">${check.name}</div>
                        <div style="font-size: 12px; color: var(--on-surface-variant)">${check.detail}</div>
                    </div>
                </div>
                <span class="status-indicator status-${check.status}">${check.status}</span>
            `;
            list.appendChild(item);
        });
        terminalBody.appendChild(list);
    } else {
        addMessage('bot', `The ${tab} view is currently under construction in this prototype.`);
    }
}

function handleInput(e) {
    if (e.key === 'Enter') {
        const val = inputField.value.trim();
        if (!val) return;

        addMessage('user', val);
        inputField.value = '';

        processCommand(val);
    }
}

function processCommand(cmd) {
    const low = cmd.toLowerCase();

    setTimeout(() => {
        if (low === 'help') {
            addMessage('bot', 'Available commands: help, swarm, doctor, clear, exit');
        } else if (low === 'clear') {
            terminalBody.innerHTML = '';
            addMessage('system', 'Terminal cleared.');
        } else if (low === 'swarm') {
            switchTab('swarm');
        } else if (low === 'doctor') {
            switchTab('doctor');
        } else {
            addMessage('bot', "I'm thinking... (Simulated processing for: " + cmd + ")");
            setTimeout(() => {
                addMessage('bot', "Task complete. I've analyzed your request.");
            }, 1000);
        }
    }, 500);
}

function addMessage(role, text) {
    if (role === 'system') {
        const div = document.createElement('div');
        div.style.color = 'var(--outline)';
        div.style.fontSize = '12px';
        div.style.margin = '16px 0';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '8px';
        div.innerHTML = `<span style="height: 1px; flex: 1; background: var(--outline-variant)"></span> ${text} <span style="height: 1px; flex: 1; background: var(--outline-variant)"></span>`;
        terminalBody.appendChild(div);
    } else {
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg msg-${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.innerText = role === 'bot' ? 'Z' : 'U';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerText = text;

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        terminalBody.appendChild(msgDiv);
    }

    terminalBody.scrollTop = terminalBody.scrollHeight;
}

window.onload = init;
