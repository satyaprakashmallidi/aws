/**
 * OpenClaw Local API — Health Check Script
 * Runs against the live Cloudflare tunnel URL.
 * Usage: node api-health-check.js [BASE_URL] [LOCAL_API_SECRET]
 *
 * Example:
 *   node api-health-check.js https://openclaw-api.magicteams.ai my-secret-here
 */

const BASE_URL = process.argv[2] || 'https://openclaw-api.magicteams.ai';
const SECRET = process.argv[3] || process.env.LOCAL_API_SECRET || '';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function icon(status) {
    if (status >= 200 && status < 300) return `${GREEN}✓${RESET}`;
    if (status === 401 || status === 403) return `${YELLOW}⚿${RESET}`;
    if (status === 404) return `${YELLOW}?${RESET}`;
    return `${RED}✗${RESET}`;
}

async function check(method, path, opts = {}) {
    const url = `${BASE_URL}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...(SECRET ? { 'x-api-secret': SECRET } : {}),
        ...(opts.headers || {})
    };
    const init = { method, headers };
    if (opts.body) init.body = JSON.stringify(opts.body);

    try {
        const res = await fetch(url, init);
        const text = await res.text().catch(() => '');
        let note = '';
        try {
            const json = JSON.parse(text);
            if (json.error) note = ` → ${json.error}`;
            else if (json.status) note = ` → status:${json.status}`;
        } catch { /* not JSON */ }
        const label = method.padEnd(6) + path;
        console.log(`  ${icon(res.status)} ${String(res.status).padEnd(4)} ${label}${note}`);
        return res.status;
    } catch (err) {
        const label = method.padEnd(6) + path;
        console.log(`  ${RED}✗${RESET} ERR  ${label} → ${err.message}`);
        return 0;
    }
}

async function main() {
    console.log(`\n${BOLD}OpenClaw Local API — Health Check${RESET}`);
    console.log(`Base URL : ${BASE_URL}`);
    console.log(`Auth     : ${SECRET ? 'x-api-secret set' : 'none (add as 3rd arg)'}`);
    console.log('─'.repeat(65));

    const results = [];
    const run = async (m, p, opts) => results.push(await check(m, p, opts));

    // ── Core ─────────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Core${RESET}`);
    await run('GET', '/api/health');
    await run('GET', '/api/heartbeat');
    await run('GET', '/api/usage');

    // ── Sub-agents ────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Sub-agents${RESET}`);
    await run('GET', '/api/subagents');
    await run('POST', '/api/subagents/spawn', { body: {} }); // expect 400 - missing task

    // ── Agents ───────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Agents (config-level)${RESET}`);
    await run('GET', '/api/agents');
    await run('GET', '/api/agents', { headers: {}, body: undefined }); // using query: ?action=models
    await run('GET', '/api/agents?action=models');

    // ── Chat ──────────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Chat${RESET}`);
    await run('GET', '/api/chat');
    await run('POST', '/api/chat', { body: {} }); // expect 400 - missing message

    // ── Models ───────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Models & Providers${RESET}`);
    await run('GET', '/api/models');
    await run('GET', '/api/models/config');
    await run('GET', '/api/models/gateway');
    await run('GET', '/api/models/catalog-all');
    await run('GET', '/api/models/catalog?provider=google');
    await run('GET', '/api/providers');
    await run('GET', '/api/providers/catalog');
    await run('GET', '/api/provider?name=google');

    // ── Config ───────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Config${RESET}`);
    await run('GET', '/api/openclaw-config');
    await run('GET', '/api/soul');

    // ── Workspace ────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Workspace${RESET}`);
    await run('GET', '/api/workspace-list');
    await run('GET', '/api/workspace-file?path=memory/SOUL.md');

    // ── Channels ─────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Channels${RESET}`);
    await run('GET', '/api/channels/list');
    await run('GET', '/api/channels/status');

    // ── Plugins ──────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Plugins${RESET}`);
    await run('GET', '/api/plugins');

    // ── Tasks ─────────────────────────────────────────────────────────────────
    console.log(`\n${BOLD}Tasks${RESET}`);
    await run('GET', '/api/tasks');
    await run('GET', '/api/tasks/queue');
    await run('GET', '/api/tasks/runs');
    await run('GET', '/api/tasks/activity');

    // ── User profile ──────────────────────────────────────────────────────────
    console.log(`\n${BOLD}User Profile (requires Clerk JWT — expect 401)${RESET}`);
    await run('GET', '/api/user/profile');
    await run('POST', '/api/user/profile/sync', { body: { username: 'test' } });

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(65));
    const ok = results.filter(s => s >= 200 && s < 300).length;
    const warn = results.filter(s => s === 400 || s === 401 || s === 403 || s === 404).length;
    const fail = results.filter(s => s === 0 || s >= 500).length;
    console.log(`${BOLD}Results:${RESET}  ${GREEN}${ok} OK${RESET}  ${YELLOW}${warn} warnings${RESET}  ${RED}${fail} errors${RESET}  (${results.length} total)`);
    console.log('\nLegend:');
    console.log(`  ${GREEN}✓${RESET} = 2xx OK             ${YELLOW}⚿${RESET} = 401/403 auth gate (expected)`);
    console.log(`  ${YELLOW}?${RESET} = 404 not found      ${RED}✗${RESET} = 4xx error or network failure\n`);

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
