// ============================================================
//  Food Truck Survey — Admin Dashboard
//  Auth-gated dashboard with NPS management + reward validator.
//  Reads survey data via Supabase (anon + RLS); privileged
//  actions (login, validate, redeem) go through admin-auth.
// ============================================================

const SUPABASE_URL = 'https://xkzicpfxlvgovugumspr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhremljcGZ4bHZnb3Z1Z3Vtc3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyODI1MzAsImV4cCI6MjA3Mjg1ODUzMH0.8xykX92QwVWccQyOz60ONb_CirdbGcKvQD8FjO8RJrA';
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

let sb = null;
let allResponses = [];
let overviewNpsCat = 'detractors';
let charts = {};
let currentUser = null;
let currentValidationRecord = null;
let dashboardLoaded = false;
let analyticsPeriod = 'all';

// Which tabs each role may see. Anything not listed = all tabs.
const ROLE_TABS = {
    validator: ['validator', 'overview', 'responses'],
};

// ============================================================
//  Utilities
// ============================================================

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function getNpsCategory(score) {
    if (score === null || score === undefined) return 'unknown';
    if (score <= 6) return 'detractor';
    if (score <= 8) return 'passive';
    return 'promoter';
}

function npsBadge(score) {
    if (score === null || score === undefined) return '<span class="nps-badge">-</span>';
    const cat = getNpsCategory(score);
    return `<span class="nps-badge ${cat}">${score}</span>`;
}

function fmtDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d)) return '-';
    return d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

function agingBadge(dateStr, status) {
    if (!dateStr) return '-';
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (status === 'resolved') return `<span class="aging-badge recent">${days}d</span>`;
    if (days > 7) return `<span class="aging-badge urgent">${days}d</span>`;
    if (days > 3) return `<span class="aging-badge old">${days}d</span>`;
    return `<span class="aging-badge recent">${days}d</span>`;
}

function getPriority(nps, daysOld) {
    if (nps <= 3) return 'Critical';
    if (daysOld > 7) return 'Urgent';
    if (daysOld > 3) return 'High';
    return 'Normal';
}

function priorityBadgeClass(priority) {
    if (priority === 'Critical' || priority === 'Urgent') return 'urgent';
    if (priority === 'High') return 'old';
    return 'recent';
}

function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// ============================================================
//  Auth
// ============================================================

const Auth = {
    token: () => localStorage.getItem('ft_admin_token'),
    getUser() {
        try { return JSON.parse(localStorage.getItem('ft_admin_user') || 'null'); }
        catch { return null; }
    },
    save(data) {
        if (data.token) localStorage.setItem('ft_admin_token', data.token);
        if (data.refresh_token) localStorage.setItem('ft_admin_refresh', data.refresh_token);
        if (data.user) localStorage.setItem('ft_admin_user', JSON.stringify(data.user));
    },
    clear() {
        localStorage.removeItem('ft_admin_token');
        localStorage.removeItem('ft_admin_refresh');
        localStorage.removeItem('ft_admin_user');
    },
    async login(email, password) {
        const res = await fetch(`${FUNCTIONS_URL}/admin-auth/login`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || data.message || 'Invalid email or password');
        }
        this.save(data);
        return data.user;
    },
    async verify() {
        const token = this.token();
        if (!token) return null;
        try {
            const res = await fetch(`${FUNCTIONS_URL}/admin-auth/verify`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) return null;
            const data = await res.json().catch(() => ({}));
            return data.valid ? data.user : null;
        } catch {
            return null;
        }
    },
    async logout() {
        const token = this.token();
        if (token) {
            try {
                await fetch(`${FUNCTIONS_URL}/admin-auth/logout`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: '{}',
                });
            } catch { /* ignore network errors on logout */ }
        }
        this.clear();
    },
};

// Authenticated call to an admin-auth sub-route.
async function adminApi(path, body) {
    const res = await fetch(`${FUNCTIONS_URL}/admin-auth/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Auth.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-json */ }
    return { ok: res.ok, status: res.status, data };
}

// ============================================================
//  Data Transformation
// ============================================================

function transformRow(row) {
    const sd = row.survey_data || {};
    const nps = sd.q8_nps !== undefined && sd.q8_nps !== null ? Number(sd.q8_nps) : null;
    const branch = sd.q3_branch || row.brand || 'Unknown';

    let ticketStatus = row.ticket_status;
    if (!ticketStatus) {
        ticketStatus = (nps !== null && nps <= 6) ? 'open' : 'resolved';
    }

    return {
        id: row.id,
        date: row.completed_at ? row.completed_at.slice(0, 10) : (row.created_at ? row.created_at.slice(0, 10) : '-'),
        completedAt: row.completed_at || row.created_at,
        receipt: row.receipt_number || '-',
        branch: branch,
        name: row.name || '-',
        email: row.email || '',
        phone: row.phone || '',
        nps: nps,
        npsComment: sd.q8_comment || '',
        npsCommentType: sd.q8_comment_type || '',
        food: sd.q7_food !== undefined ? Number(sd.q7_food) : null,
        foodComment: sd.q7_food_comment || '',
        service: sd.q7_service !== undefined ? Number(sd.q7_service) : null,
        serviceComment: sd.q7_service_comment || '',
        price: sd.q7_price !== undefined ? Number(sd.q7_price) : null,
        priceComment: sd.q7_price_comment || '',
        enjoyExperience: sd.q1 || '',
        enjoyComment: sd.q1_comment || '',
        discovery: sd.q2_choice || '',
        previousVisit: sd.q3 || '',
        location: sd.q4 || '',
        spend: sd.q6_spend || '',
        cuisines: sd.q9 || '',
        returnIntention: sd.q10_return || '',
        followUpdates: sd.q10 || '',
        rewardCode: row.reward_code || '',
        rewardClaimed: !!row.reward_claimed,
        ticketStatus: ticketStatus,
        raw: row
    };
}

// ============================================================
//  Supabase Data Fetching
// ============================================================

async function fetchResponses() {
    if (!sb) return [];
    try {
        const { data, error } = await sb
            .from('submissions')
            .select('*')
            .eq('status', 'completed')
            .order('completed_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(transformRow).filter(r => r.nps !== null);
    } catch (err) {
        console.error('Failed to fetch responses:', err);
        return [];
    }
}

async function updateTicketStatus(id, newStatus) {
    if (!sb) return false;
    try {
        const { error } = await sb
            .from('submissions')
            .update({ ticket_status: newStatus })
            .eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.warn('Failed to update ticket status:', err?.message);
        return true;
    }
}

// ============================================================
//  NPS Calculations
// ============================================================

function calculateNPS(responses) {
    const scored = responses.filter(r => r.nps !== null);
    if (scored.length === 0) return { score: 0, promoters: 0, passives: 0, detractors: 0, total: 0 };
    const promoters = scored.filter(r => r.nps >= 9).length;
    const passives = scored.filter(r => r.nps >= 7 && r.nps <= 8).length;
    const detractors = scored.filter(r => r.nps <= 6).length;
    const total = scored.length;
    const score = Math.round(((promoters - detractors) / total) * 100);
    return { score, promoters, passives, detractors, total };
}

function getDetractors(responses) {
    return responses
        .filter(r => r.nps !== null && r.nps <= 6)
        .sort((a, b) => {
            const aDays = Math.floor((Date.now() - new Date(a.completedAt).getTime()) / 86400000);
            const bDays = Math.floor((Date.now() - new Date(b.completedAt).getTime()) / 86400000);
            const getPrio = (nps, days) => {
                if (nps <= 3) return 0;
                if (days > 7) return 1;
                if (days > 3) return 2;
                return 3;
            };
            const aPrio = getPrio(a.nps, aDays);
            const bPrio = getPrio(b.nps, bDays);
            if (aPrio !== bPrio) return aPrio - bPrio;
            return bDays - aDays;
        });
}

// ============================================================
//  Status Select Renderer
// ============================================================

function statusSelectHtml(currentStatus, id) {
    const s = currentStatus || 'open';
    return `<select class="statusSel ${escapeHtml(s)}" data-id="${escapeHtml(id)}">
        <option value="open" ${s === 'open' ? 'selected' : ''}>Open</option>
        <option value="in_progress" ${s === 'in_progress' ? 'selected' : ''}>In Progress</option>
        <option value="resolved" ${s === 'resolved' ? 'selected' : ''}>Resolved</option>
        <option value="voc" ${s === 'voc' ? 'selected' : ''}>VOC</option>
        <option value="inactive" ${s === 'inactive' ? 'selected' : ''}>Inactive</option>
    </select>`;
}

function attachStatusHandlers(container) {
    container.querySelectorAll('.statusSel').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const newStatus = e.target.value;
            e.target.className = `statusSel ${newStatus}`;
            await updateTicketStatus(id, newStatus);
            const response = allResponses.find(r => r.id === id);
            if (response) response.ticketStatus = newStatus;
        });
    });
}

function attachViewHandlers(container) {
    container.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => showResponseDetail(btn.dataset.view));
    });
}

// ============================================================
//  Overview Tab
// ============================================================

function paintOverview() {
    const detractors = getDetractors(allResponses);
    const critical = detractors.filter(r => r.nps <= 3);
    const promoters = allResponses.filter(r => r.nps !== null && r.nps >= 9);
    const passives = allResponses.filter(r => r.nps !== null && r.nps >= 7 && r.nps <= 8);
    const openTickets = allResponses.filter(r => r.ticketStatus === 'open' || !r.ticketStatus);

    const foodRatings = allResponses.filter(r => r.food !== null).map(r => r.food);
    const avgFood = foodRatings.length > 0 ? (foodRatings.reduce((a, b) => a + b, 0) / foodRatings.length).toFixed(1) : '-';

    document.getElementById('kpiCritical').textContent = critical.length;
    document.getElementById('kpiDetractors').textContent = detractors.length - critical.length;
    document.getElementById('kpiOpenTickets').textContent = openTickets.length;
    document.getElementById('kpiPromoterCount').textContent = promoters.length;
    document.getElementById('kpiAvgFood').textContent = avgFood;

    const npsData = calculateNPS(allResponses);
    const npsScoreEl = document.getElementById('overviewNpsScore');
    npsScoreEl.textContent = npsData.score;
    npsScoreEl.style.color = npsData.score > 0 ? 'var(--ok)' : npsData.score < 0 ? 'var(--bad)' : 'var(--warn)';

    document.getElementById('overviewPromotersPct').textContent = `${npsData.total ? Math.round((npsData.promoters / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewPassivesPct').textContent = `${npsData.total ? Math.round((npsData.passives / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewDetractorsPct').textContent = `${npsData.total ? Math.round((npsData.detractors / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewTotal').textContent = npsData.total;

    document.getElementById('btnDetractorsCount').textContent = detractors.length;
    document.getElementById('btnPassivesCount').textContent = passives.length;
    document.getElementById('btnPromotersCount').textContent = promoters.length;

    paintOverviewTable();
}

function paintOverviewTable() {
    const tbody = document.getElementById('overviewBody');
    const thead = document.getElementById('overviewTableHead');
    tbody.innerHTML = '';

    let rows = [];
    let emptyMsg = '';

    if (overviewNpsCat === 'detractors') {
        rows = getDetractors(allResponses);
        emptyMsg = 'No detractors found. Great job!';
        thead.innerHTML = '<tr><th>Age</th><th>NPS</th><th>Branch</th><th>Customer</th><th>Feedback</th><th>Priority</th><th>Status</th><th>Actions</th></tr>';
    } else if (overviewNpsCat === 'passives') {
        rows = allResponses.filter(r => r.nps !== null && r.nps >= 7 && r.nps <= 8)
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        emptyMsg = 'No passives found.';
        thead.innerHTML = '<tr><th>Age</th><th>NPS</th><th>Branch</th><th>Customer</th><th>Feedback</th><th>Status</th><th>Actions</th></tr>';
    } else {
        rows = allResponses.filter(r => r.nps !== null && r.nps >= 9)
            .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        emptyMsg = 'No promoters found yet.';
        thead.innerHTML = '<tr><th>Age</th><th>NPS</th><th>Branch</th><th>Customer</th><th>Feedback</th><th>Status</th><th>Actions</th></tr>';
    }

    if (rows.length === 0) {
        const cs = overviewNpsCat === 'detractors' ? 8 : 7;
        tbody.innerHTML = `<tr><td colspan="${cs}"><div class="empty">${emptyMsg}</div></td></tr>`;
        return;
    }

    if (overviewNpsCat === 'detractors') {
        rows.forEach(r => {
            const daysOld = Math.floor((Date.now() - new Date(r.completedAt).getTime()) / 86400000);
            const priority = getPriority(r.nps, daysOld);
            const tr = document.createElement('tr');
            if (r.nps <= 3) tr.className = 'priority-critical';
            else if (daysOld > 7) tr.className = 'priority-urgent';
            tr.innerHTML = `
                <td data-label="Age">${agingBadge(r.completedAt, r.ticketStatus)}</td>
                <td data-label="NPS">${npsBadge(r.nps)}</td>
                <td data-label="Branch">${escapeHtml(r.branch)}</td>
                <td data-label="Customer">${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
                <td data-label="Feedback" class="cell-feedback">${escapeHtml(r.npsComment) || '-'}</td>
                <td data-label="Priority"><span class="aging-badge ${priorityBadgeClass(priority)}">${priority}</span></td>
                <td data-label="Status">${statusSelectHtml(r.ticketStatus, r.id)}</td>
                <td data-label="Actions"><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td data-label="Age">${agingBadge(r.completedAt, r.ticketStatus)}</td>
                <td data-label="NPS">${npsBadge(r.nps)}</td>
                <td data-label="Branch">${escapeHtml(r.branch)}</td>
                <td data-label="Customer">${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
                <td data-label="Feedback" class="cell-feedback">${escapeHtml(r.npsComment) || '-'}</td>
                <td data-label="Status">${statusSelectHtml(r.ticketStatus, r.id)}</td>
                <td data-label="Actions"><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    attachStatusHandlers(tbody);
    attachViewHandlers(tbody);
}

// ============================================================
//  Responses Tab
// ============================================================

function getFilteredResponses() {
    const search = document.getElementById('respSearch').value.toLowerCase();
    const dateStart = document.getElementById('respDateStart').value;
    const dateEnd = document.getElementById('respDateEnd').value;
    const nps = document.getElementById('respNps').value;
    const branch = document.getElementById('respBranch').value;
    const status = document.getElementById('respStatus').value;

    let filtered = allResponses;
    if (search) filtered = filtered.filter(r => (r.npsComment || '').toLowerCase().includes(search) || (r.name || '').toLowerCase().includes(search) || (r.email || '').toLowerCase().includes(search));
    if (dateStart) filtered = filtered.filter(r => r.date >= dateStart);
    if (dateEnd) filtered = filtered.filter(r => r.date <= dateEnd);
    if (nps !== 'all') filtered = filtered.filter(r => getNpsCategory(r.nps) === nps);
    if (branch !== 'all') filtered = filtered.filter(r => r.branch === branch);
    if (status !== 'all') filtered = filtered.filter(r => r.ticketStatus === status);
    return filtered;
}

function paintResponses() {
    const filtered = getFilteredResponses();
    const tbody = document.getElementById('responsesBody');
    tbody.innerHTML = '';
    document.getElementById('respCount').textContent = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10"><div class="empty">No responses match filters.</div></td></tr>';
        return;
    }

    filtered.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Date">${escapeHtml(r.date)}</td>
            <td data-label="NPS">${npsBadge(r.nps)}</td>
            <td data-label="Branch">${escapeHtml(r.branch)}</td>
            <td data-label="Customer">${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
            <td data-label="Feedback" class="cell-feedback">${escapeHtml(r.npsComment) || '-'}</td>
            <td data-label="Food">${r.food !== null ? `<strong>${r.food}</strong>/10` : '-'}</td>
            <td data-label="Service">${r.service !== null ? `<strong>${r.service}</strong>/10` : '-'}</td>
            <td data-label="Price">${r.price !== null ? `<strong>${r.price}</strong>/10` : '-'}</td>
            <td data-label="Status">${statusSelectHtml(r.ticketStatus, r.id)}</td>
            <td data-label="Actions"><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
        `;
        tbody.appendChild(tr);
    });

    attachStatusHandlers(tbody);
    attachViewHandlers(tbody);
}

// ============================================================
//  Analytics Tab
// ============================================================

function getAnalyticsResponses() {
    if (analyticsPeriod === 'all') return allResponses;
    const cutoff = Date.now() - Number(analyticsPeriod) * 86400000;
    return allResponses.filter(r => r.completedAt && new Date(r.completedAt).getTime() >= cutoff);
}

function paintAnalytics() {
    const data = getAnalyticsResponses();
    const styles = getComputedStyle(document.documentElement);
    const ok = styles.getPropertyValue('--ok').trim() || '#15803d';
    const warn = styles.getPropertyValue('--warn').trim() || '#d97706';
    const bad = styles.getPropertyValue('--bad').trim() || '#b91c1c';
    const accent = styles.getPropertyValue('--accent').trim() || '#0e9ba4';

    const npsData = calculateNPS(data);

    // KPIs
    document.getElementById('anNps').textContent = npsData.score;
    document.getElementById('anPromoters').textContent = npsData.promoters;
    document.getElementById('anPassives').textContent = npsData.passives;
    document.getElementById('anDetractors').textContent = npsData.detractors;
    document.getElementById('anTotal').textContent = npsData.total;

    renderChart('chartNpsDist', 'doughnut', {
        labels: ['Promoters', 'Passives', 'Detractors'],
        datasets: [{ data: [npsData.promoters, npsData.passives, npsData.detractors], backgroundColor: [ok, warn, bad], borderWidth: 0 }]
    }, { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } });

    const branches = [...new Set(data.map(r => r.branch))];
    const branchCounts = branches.map(b => data.filter(r => r.branch === b).length);
    renderChart('chartBranch', 'bar', {
        labels: branches,
        datasets: [{ label: 'Responses', data: branchCounts, backgroundColor: accent + 'b3' }]
    }, { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } });

    const avgOf = (arr) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
    const foods = data.filter(r => r.food !== null).map(r => r.food);
    const services = data.filter(r => r.service !== null).map(r => r.service);
    const prices = data.filter(r => r.price !== null).map(r => r.price);
    renderChart('chartRatings', 'radar', {
        labels: ['Food', 'Service', 'Price'],
        datasets: [{ label: 'Average Rating', data: [avgOf(foods), avgOf(services), avgOf(prices)], backgroundColor: accent + '33', borderColor: accent, pointBackgroundColor: accent, borderWidth: 2 }]
    }, { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 10 } }, plugins: { legend: { display: false } } });

    const now = new Date();
    const labels = [];
    const counts = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        labels.push(d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
        counts.push(data.filter(r => r.date === key).length);
    }
    renderChart('chartTrend', 'line', {
        labels: labels,
        datasets: [{ label: 'Responses', data: counts, borderColor: accent, backgroundColor: accent + '1a', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 }]
    }, { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } });

    renderQuestionSummaries(data);
}

// ============================================================
//  Question Summaries (fuzzy-grouped per-question breakdown)
// ============================================================

const QUESTION_SUMMARIES = [
    { key: 'q1',         q: 'Q1',  label: 'Enjoyed the pop-up experience?',     type: 'choice', tag: 'Experience' },
    { key: 'q2_choice',  q: 'Q2',  label: 'Where did you hear about us?',       type: 'choice', tag: 'Discovery' },
    { key: 'q9',         q: 'Q3',  label: 'Cuisine most interested in',         type: 'multi',  tag: 'Menu' },
    { key: 'q3',         q: 'Q4',  label: 'Visited a branch before?',           type: 'choice', tag: 'Visit' },
    { key: 'q3_branch',  q: 'Q5',  label: 'Which branch visited',               type: 'choice', tag: 'Visit' },
    { key: 'q4',         q: 'Q6',  label: 'Where to bring the truck next',      type: 'choice', tag: 'Expansion' },
    { key: 'q5',         q: 'Q7',  label: 'Working or living nearby?',          type: 'choice', tag: 'Audience' },
    { key: 'q6_spend',   q: 'Q8',  label: 'Usual dining-out spend',            type: 'choice', tag: 'Spend' },
    { key: 'q7_food',    q: 'Q9',  label: 'Food rating',                        type: 'rating', tag: 'Rating' },
    { key: 'q7_service', q: 'Q10', label: 'Service rating',                     type: 'rating', tag: 'Rating' },
    { key: 'q7_price',   q: 'Q11', label: 'Value for price rating',            type: 'rating', tag: 'Rating' },
    { key: 'q8_nps',     q: 'Q12', label: 'Likelihood to recommend (NPS)',     type: 'rating', tag: 'NPS' },
    { key: 'q10_return', q: 'Q13', label: 'Return intention',                   type: 'choice', tag: 'Loyalty' },
    { key: 'q10',        q: 'Q14', label: 'Wants to hear more from us?',        type: 'choice', tag: 'Marketing' },
    { key: 'q8_comment', q: 'Q12', label: 'NPS feedback comments',              type: 'text', fuzzy: true, skipNulls: true, tag: 'Voice of Customer' },
];

const QS_TAG_COLORS = {
    Experience: '#0e9a5a', Discovery: '#1f6feb', Menu: '#b8860b', Visit: '#0e9a5a',
    Expansion: '#1f6feb', Audience: '#7c6f9c', Spend: '#d97706', Rating: '#7c6f9c',
    NPS: '#c41e3a', Loyalty: '#15803d', Marketing: '#0e9ba4', 'Voice of Customer': '#6b7280',
};

const FUZZY_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'and', 'or', 'to', 'our', 'your', 'my', 'me', 'i', 'is', 'are', 'was', 'it', 'for', 'with', 'from', 'this', 'that', 'po', 'na', 'ng', 'sa', 'ang', 'yung', 'very', 'really', 'so', 'just', 'more', 'please', 'pls', 'also', 'would', 'will', 'be', 'have', 'has', 'had', 'they', 'we', 'you']);
const TEXT_SKIP = new Set(['none', 'n/a', 'na', 'wala', 'nothing', 'no', 'nope', '-', '.', 'x', 'xx', 'xxx', 'test', 'asd', 'asdf', 'qwerty', 'none.', 'na.']);

function getSD(r) { return (r.raw && r.raw.survey_data) || {}; }

function fuzzyNormalize(s) {
    return String(s).toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function fuzzyTokens(s) {
    return fuzzyNormalize(s).split(' ')
        .filter(t => t && !FUZZY_STOPWORDS.has(t))
        .map(t => (t.length > 3 && t.endsWith('s')) ? t.slice(0, -1) : t);
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[n];
}

function fuzzySimilar(aTok, bTok) {
    if (!aTok.length || !bTok.length) return false;
    const aSet = new Set(aTok), bSet = new Set(bTok);
    let inter = 0;
    for (const t of aSet) if (bSet.has(t)) inter++;
    const smaller = Math.min(aSet.size, bSet.size);
    const union = aSet.size + bSet.size - inter;
    if (inter > 0 && inter === smaller) return true;
    if (inter > 0 && inter / union >= 0.5) return true;
    if (aSet.size === 1 && bSet.size === 1) {
        const x = [...aSet][0], y = [...bSet][0];
        if (x.length >= 4 && y.length >= 4) {
            const ratio = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
            if (ratio >= 0.8) return true;
        }
    }
    return false;
}

function fuzzyGroup(values) {
    const variants = new Map();
    for (const raw of values) {
        const display = String(raw).trim();
        if (!display) continue;
        const tokens = fuzzyTokens(display);
        const sig = tokens.length ? tokens.join(' ') : fuzzyNormalize(display);
        if (!sig) continue;
        if (!variants.has(sig)) variants.set(sig, { tokens: tokens.length ? tokens : [sig], count: 0, displays: new Map() });
        const v = variants.get(sig);
        v.count++;
        v.displays.set(display, (v.displays.get(display) || 0) + 1);
    }
    const entries = [...variants.values()].sort((a, b) => b.count - a.count);
    const clusters = [];
    for (const e of entries) {
        let placed = false;
        for (const c of clusters) {
            if (fuzzySimilar(e.tokens, c.tokens)) {
                c.count += e.count;
                for (const [d, k] of e.displays) c.displays.set(d, (c.displays.get(d) || 0) + k);
                placed = true;
                break;
            }
        }
        if (!placed) clusters.push({ tokens: e.tokens, count: e.count, displays: new Map(e.displays) });
    }
    return clusters.map(c => {
        let bestD = '', bestN = -1;
        for (const [d, k] of c.displays) if (k > bestN) { bestN = k; bestD = d; }
        return { value: bestD, count: c.count };
    }).sort((a, b) => b.count - a.count);
}

function qComputeTopN(responses, key, opts, n = 10) {
    const { isArray = false, skipNulls = false, fuzzy = false } = opts || {};
    const raw = [];
    for (const r of responses) {
        const val = getSD(r)[key];
        if (val === null || val === undefined || val === '') continue;
        const items = isArray ? (Array.isArray(val) ? val : String(val).split(',')) : [val];
        for (const item of items) {
            if (item === null || item === undefined) continue;
            const s = String(item).trim();
            if (!s || s === '-') continue;
            if (skipNulls && TEXT_SKIP.has(s.toLowerCase())) continue;
            raw.push(s);
        }
    }
    let grouped;
    if (fuzzy) {
        grouped = fuzzyGroup(raw);
    } else {
        const counts = new Map();
        for (const s of raw) {
            const k = s.toLowerCase();
            if (!counts.has(k)) counts.set(k, { value: s, count: 0 });
            counts.get(k).count++;
        }
        grouped = [...counts.values()].sort((a, b) => b.count - a.count);
    }
    return grouped.slice(0, n).map((v, i) => ({ rank: i + 1, value: v.value, count: v.count }));
}

function qSummarizeRating(responses, key) {
    const dist = new Map();
    let sum = 0, count = 0;
    for (const r of responses) {
        const v = getSD(r)[key];
        if (v === null || v === undefined || v === '') continue;
        const num = Number(v);
        if (!Number.isFinite(num)) continue;
        dist.set(num, (dist.get(num) || 0) + 1);
        sum += num; count++;
    }
    const rows = [...dist.entries()].sort((a, b) => b[0] - a[0]).map(([s, c]) => ({ value: String(s), count: c }));
    return { rows, avg: count ? sum / count : 0, count };
}

function qsRankRows(data, total, emptyMsg) {
    if (!data.length) return `<div class="qs-empty">${emptyMsg || 'No data yet.'}</div>`;
    const max = data[0].count;
    return data.map(row => {
        const pct = total > 0 ? Math.round(row.count / total * 100) : 0;
        const barW = Math.round(row.count / max * 100);
        const top = row.rank <= 3;
        const rcls = row.rank === 1 ? 'r1' : row.rank === 2 ? 'r2' : row.rank === 3 ? 'r3' : '';
        return `<div class="qs-row">
            <span class="qs-rank ${rcls}">${row.rank}</span>
            <div class="qs-label ${top ? 'top' : ''}">
                <div class="t" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</div>
                <div class="qs-bar"><i style="width:${barW}%"></i></div>
            </div>
            <span class="qs-count">${row.count}</span>
            <span class="qs-pct">${pct}%</span>
        </div>`;
    }).join('');
}

function qsRatingCard(responses, key) {
    const { rows, avg, count } = qSummarizeRating(responses, key);
    if (!count) return `<div class="qs-empty">No ratings yet.</div>`;
    const max = Math.max(...rows.map(r => r.count));
    const color = avg >= 8 ? 'var(--ok)' : avg >= 6 ? 'var(--warn)' : 'var(--bad)';
    const bars = rows.map(r => {
        const barW = Math.round(r.count / max * 100);
        const pct = Math.round(r.count / count * 100);
        return `<div class="qs-rrow"><span class="sc">${r.value}</span><div class="bar"><i style="width:${barW}%;background:${color}"></i></div><span class="ct">${r.count} · ${pct}%</span></div>`;
    }).join('');
    return `<div class="qs-rating-avg"><span class="n" style="color:${color}">${avg.toFixed(1)}</span><span class="s">avg · ${count} response${count === 1 ? '' : 's'}</span></div>${bars}`;
}

function renderQuestionSummaries(responses) {
    const c = document.getElementById('questionSummaries');
    if (!c) return;
    const total = responses.length;
    c.innerHTML = QUESTION_SUMMARIES.map(q => {
        const color = QS_TAG_COLORS[q.tag] || '#0e9ba4';
        let body;
        if (q.type === 'rating') {
            body = qsRatingCard(responses, q.key);
        } else {
            const rows = qComputeTopN(responses, q.key, { isArray: q.type === 'multi', skipNulls: !!q.skipNulls, fuzzy: !!q.fuzzy }, 10);
            const empty = q.skipNulls ? 'No meaningful answers yet.' : 'No data yet.';
            body = qsRankRows(rows, total, empty);
        }
        return `<div class="qs-card">
            <div class="qs-card-head"><span class="qs-tag" style="background:${color}">${q.q} · ${q.tag}</span><span class="qs-q">${escapeHtml(q.label)}</span></div>
            ${body}
        </div>`;
    }).join('');
}

function renderChart(canvasId, type, data, options) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext('2d');
    if (charts[canvasId]) {
        charts[canvasId].data = data;
        charts[canvasId].update();
    } else {
        charts[canvasId] = new Chart(ctx, { type, data, options });
    }
}

// ============================================================
//  Export Tab
// ============================================================

function getExportFiltered() {
    const nps = document.getElementById('exportNps').value;
    const branch = document.getElementById('exportBranch').value;
    let filtered = allResponses;
    if (nps !== 'all') filtered = filtered.filter(r => getNpsCategory(r.nps) === nps);
    if (branch !== 'all') filtered = filtered.filter(r => r.branch === branch);
    return filtered;
}

function updateExportPreview() {
    const filtered = getExportFiltered();
    document.getElementById('exportPreview').innerHTML = `Select filters and click Download CSV. <strong>${filtered.length}</strong> responses will be exported.`;
}

function downloadCSV() {
    const filtered = getExportFiltered();
    if (filtered.length === 0) return;

    const headers = ['Date', 'Receipt', 'Branch', 'Name', 'Email', 'Phone', 'NPS', 'NPS Category', 'NPS Comment', 'Food Rating', 'Food Comment', 'Service Rating', 'Service Comment', 'Price Rating', 'Price Comment', 'Enjoy Experience', 'Discovery', 'Spend', 'Cuisines', 'Return Intention', 'Reward Code', 'Reward Claimed', 'Ticket Status'];

    const csvRows = [headers.join(',')];
    filtered.forEach(r => {
        const row = [
            r.date, r.receipt, r.branch, r.name, r.email, r.phone,
            r.nps, getNpsCategory(r.nps), `"${(r.npsComment || '').replace(/"/g, '""')}"`,
            r.food, `"${(r.foodComment || '').replace(/"/g, '""')}"`,
            r.service, `"${(r.serviceComment || '').replace(/"/g, '""')}"`,
            r.price, `"${(r.priceComment || '').replace(/"/g, '""')}"`,
            r.enjoyExperience, r.discovery, r.spend,
            `"${(r.cuisines || '').replace(/"/g, '""')}"`,
            r.returnIntention, r.rewardCode, r.rewardClaimed ? 'Yes' : 'No', r.ticketStatus
        ];
        csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `food-truck-survey-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================
//  Validator Tab
// ============================================================

function resetValidator() {
    currentValidationRecord = null;
    document.getElementById('validatorStatus').textContent = 'Enter a reward code or receipt number to validate.';
    document.getElementById('validatorStatus').className = 'val-status';
    document.getElementById('validatorDetails').style.display = 'none';
    document.getElementById('validatorActions').style.display = 'none';
}

async function runValidate() {
    const input = document.getElementById('validatorInput');
    const query = input.value.trim();
    const statusEl = document.getElementById('validatorStatus');
    const detailsEl = document.getElementById('validatorDetails');
    const actionsEl = document.getElementById('validatorActions');

    if (!query) {
        statusEl.textContent = 'Please enter a code or receipt number.';
        statusEl.className = 'val-status invalid';
        detailsEl.style.display = 'none';
        actionsEl.style.display = 'none';
        return;
    }

    statusEl.textContent = 'Searching…';
    statusEl.className = 'val-status';
    detailsEl.style.display = 'none';
    actionsEl.style.display = 'none';

    let resp;
    try {
        resp = await adminApi('validate-reward', { query });
    } catch {
        statusEl.textContent = '⚠️ Network error. Please try again.';
        statusEl.className = 'val-status invalid';
        return;
    }

    if (!resp.ok || !resp.data || resp.data.success === false || !resp.data.data) {
        statusEl.textContent = '❌ No matching record found.';
        statusEl.className = 'val-status invalid';
        currentValidationRecord = null;
        return;
    }

    const rec = resp.data.data;
    currentValidationRecord = rec;
    const sd = rec.survey_data || {};
    const nps = sd.q8_nps !== undefined && sd.q8_nps !== null ? Number(sd.q8_nps) : null;

    document.getElementById('valCustomer').textContent = rec.name || '-';
    document.getElementById('valNps').innerHTML = npsBadge(nps);
    document.getElementById('valReceipt').textContent = rec.receipt_number || '-';
    document.getElementById('valCode').textContent = rec.reward_code || '-';
    document.getElementById('valDate').textContent = fmtDate(rec.completed_at || rec.created_at);

    if (rec.reward_claimed) {
        statusEl.textContent = '⚠️ Reward already claimed';
        statusEl.className = 'val-status claimed';
        let info = `Claimed on ${fmtDate(rec.reward_claimed_at)}`;
        document.getElementById('valRewardStatus').innerHTML = `<span style="color:var(--warn)">${escapeHtml(info)}</span>`;
        actionsEl.style.display = 'none';
    } else {
        statusEl.textContent = '✅ Valid — reward available';
        statusEl.className = 'val-status valid';
        document.getElementById('valRewardStatus').innerHTML = '<span style="color:var(--ok)">Unclaimed</span>';
        const btn = document.getElementById('markRedeemedBtn');
        btn.disabled = false;
        btn.textContent = 'Mark as Redeemed';
        actionsEl.style.display = 'flex';
    }

    detailsEl.style.display = 'block';
}

async function runMarkRedeemed() {
    if (!currentValidationRecord) return;
    const btn = document.getElementById('markRedeemedBtn');
    const statusEl = document.getElementById('validatorStatus');
    btn.disabled = true;
    btn.textContent = 'Processing…';

    let resp;
    try {
        resp = await adminApi('mark-redeemed', { id: currentValidationRecord.id });
    } catch {
        btn.disabled = false;
        btn.textContent = 'Mark as Redeemed';
        statusEl.textContent = '⚠️ An error occurred. Please try again.';
        statusEl.className = 'val-status invalid';
        return;
    }

    if (resp.ok && resp.data && resp.data.success !== false) {
        const claimedAt = (resp.data.data && resp.data.data.reward_claimed_at) || new Date().toISOString();
        btn.textContent = '✓ Redeemed';
        statusEl.textContent = '✅ Reward successfully marked as redeemed!';
        statusEl.className = 'val-status valid';
        document.getElementById('valRewardStatus').innerHTML = `<span style="color:var(--warn)">Claimed on ${escapeHtml(fmtDate(claimedAt))}</span>`;
        document.getElementById('validatorActions').style.display = 'none';
        currentValidationRecord.reward_claimed = true;

        // Keep local dashboard data in sync if this record is loaded.
        const local = allResponses.find(r => r.id === currentValidationRecord.id);
        if (local) local.rewardClaimed = true;
    } else {
        btn.disabled = false;
        btn.textContent = 'Mark as Redeemed';
        statusEl.textContent = '❌ Failed to mark as redeemed. Please try again.';
        statusEl.className = 'val-status invalid';
    }
}

// ============================================================
//  Response Detail Modal
// ============================================================

function showResponseDetail(id) {
    const r = allResponses.find(res => res.id === id);
    if (!r) return;

    const cat = getNpsCategory(r.nps);
    document.getElementById('modalTitle').textContent = `Response — ${r.name}`;
    document.getElementById('modalBody').innerHTML = `
        <div class="detail-grid">
            <div class="detail-item"><div class="dl">Date</div><div class="dv">${escapeHtml(r.date)}</div></div>
            <div class="detail-item"><div class="dl">Receipt</div><div class="dv">${escapeHtml(r.receipt)}</div></div>
            <div class="detail-item"><div class="dl">Branch</div><div class="dv">${escapeHtml(r.branch)}</div></div>
            <div class="detail-item"><div class="dl">NPS Score</div><div class="dv">${npsBadge(r.nps)} <small>(${cat})</small></div></div>
            <div class="detail-item"><div class="dl">Name</div><div class="dv">${escapeHtml(r.name)}</div></div>
            <div class="detail-item"><div class="dl">Email</div><div class="dv">${escapeHtml(r.email)}</div></div>
            <div class="detail-item"><div class="dl">Phone</div><div class="dv">${escapeHtml(r.phone) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Status</div><div class="dv">${escapeHtml(r.ticketStatus)}</div></div>
            <div class="detail-item"><div class="dl">Reward Code</div><div class="dv">${escapeHtml(r.rewardCode) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Reward</div><div class="dv">${r.rewardClaimed ? 'Claimed' : 'Unclaimed'}</div></div>
            <div class="detail-item detail-full"><div class="dl">NPS Feedback</div><div class="dv">${escapeHtml(r.npsComment) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Food Rating</div><div class="dv">${r.food !== null ? r.food + '/10' : '-'}</div></div>
            <div class="detail-item"><div class="dl">Service Rating</div><div class="dv">${r.service !== null ? r.service + '/10' : '-'}</div></div>
            <div class="detail-item"><div class="dl">Price Rating</div><div class="dv">${r.price !== null ? r.price + '/10' : '-'}</div></div>
            <div class="detail-item"><div class="dl">Enjoy Experience</div><div class="dv">${escapeHtml(r.enjoyExperience) || '-'}</div></div>
            ${r.foodComment ? `<div class="detail-item detail-full"><div class="dl">Food Comment</div><div class="dv">${escapeHtml(r.foodComment)}</div></div>` : ''}
            ${r.serviceComment ? `<div class="detail-item detail-full"><div class="dl">Service Comment</div><div class="dv">${escapeHtml(r.serviceComment)}</div></div>` : ''}
            ${r.priceComment ? `<div class="detail-item detail-full"><div class="dl">Price Comment</div><div class="dv">${escapeHtml(r.priceComment)}</div></div>` : ''}
            <div class="detail-item"><div class="dl">Discovery Method</div><div class="dv">${escapeHtml(r.discovery) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Spend Range</div><div class="dv">${escapeHtml(r.spend) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Cuisines Interest</div><div class="dv">${escapeHtml(r.cuisines) || '-'}</div></div>
            <div class="detail-item"><div class="dl">Return Intention</div><div class="dv">${escapeHtml(r.returnIntention) || '-'}</div></div>
        </div>
    `;
    document.getElementById('modalOverlay').classList.add('show');
}

// ============================================================
//  Tab Navigation
// ============================================================

function setTab(tabName) {
    document.querySelectorAll('.tabpanel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById('tab-' + tabName);
    if (panel) panel.classList.add('active');
    const tab = document.querySelector(`.sidebar-tab[data-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');

    if (tabName === 'overview') paintOverview();
    if (tabName === 'responses') paintResponses();
    if (tabName === 'analytics') paintAnalytics();
    if (tabName === 'export') updateExportPreview();
    if (tabName === 'validator') document.getElementById('validatorInput')?.focus();
}

// ============================================================
//  Populate Branch Dropdowns
// ============================================================

function populateBranchDropdowns() {
    const branches = [...new Set(allResponses.map(r => r.branch))].sort();
    ['respBranch', 'exportBranch'].forEach(id => {
        const sel = document.getElementById(id);
        sel.innerHTML = '<option value="all">All Branches</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            sel.appendChild(opt);
        });
    });
}

// ============================================================
//  Role-based visibility
// ============================================================

function applyRoleVisibility(role) {
    const allowed = ROLE_TABS[role];
    document.querySelectorAll('.sidebar-tab[data-tab]').forEach(tab => {
        const name = tab.dataset.tab;
        const show = !allowed || allowed.includes(name);
        tab.style.display = show ? '' : 'none';
    });
    // Pick a sensible default tab for the role.
    const defaultTab = (allowed && !allowed.includes('overview')) ? allowed[0] : 'overview';
    return defaultTab;
}

// ============================================================
//  Screen switching (login vs app)
// ============================================================

function hideBootLoader() {
    const bl = document.getElementById('bootLoader');
    if (bl) bl.style.display = 'none';
}

function showLogin(message) {
    hideBootLoader();
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appShell').style.display = 'none';
    if (message) {
        const err = document.getElementById('loginError');
        err.textContent = message;
        err.style.display = 'block';
    }
}

async function showApp(user) {
    currentUser = user;
    hideBootLoader();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appShell').style.display = 'flex';

    // User badge + role
    document.getElementById('userBadgeEmail').textContent = user.email || '';
    document.getElementById('userBadgeAvatar').textContent = (user.email || '?').charAt(0);
    const roleLabel = (user.role || '').replace('_', ' ');
    document.getElementById('userBadgeRole').textContent = roleLabel;

    const defaultTab = applyRoleVisibility(user.role);

    if (!dashboardLoaded) {
        document.getElementById('overviewBody').innerHTML = '<tr><td colspan="8"><div class="empty"><div class="spinner"></div><br>Loading responses…</div></td></tr>';
        allResponses = await fetchResponses();
        populateBranchDropdowns();
        dashboardLoaded = true;
    }

    resetValidator();
    setTab(defaultTab);
}

// ============================================================
//  Init
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    if (window.supabase?.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // ---- Login form ----
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('loginBtn');
        const err = document.getElementById('loginError');
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        err.style.display = 'none';
        btn.disabled = true;
        btn.classList.add('loading');
        try {
            const user = await Auth.login(email, password);
            await showApp(user);
        } catch (ex) {
            err.textContent = ex.message || 'Login failed.';
            err.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.classList.remove('loading');
        }
    });

    // ---- Logout ----
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await Auth.logout();
        dashboardLoaded = false;
        allResponses = [];
        location.reload();
    });

    // ---- Sidebar navigation ----
    document.querySelectorAll('.sidebar-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            setTab(tab.dataset.tab);
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('visible');
        });
    });

    // ---- Mobile menu ----
    document.getElementById('menuToggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('open');
        document.getElementById('sidebarOverlay').classList.add('visible');
    });
    document.getElementById('sidebarOverlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('visible');
    });
    document.getElementById('sidebarClose').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('visible');
    });

    // ---- NPS category buttons (overview) ----
    document.querySelectorAll('.nps-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            overviewNpsCat = btn.dataset.npsCat;
            document.querySelectorAll('.nps-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paintOverviewTable();
        });
    });

    // ---- Response filters ----
    const debouncedPaint = debounce(paintResponses, 300);
    document.getElementById('respSearch').addEventListener('input', debouncedPaint);
    ['respDateStart', 'respDateEnd', 'respNps', 'respBranch', 'respStatus'].forEach(id => {
        document.getElementById(id).addEventListener('change', paintResponses);
    });

    // ---- Analytics period selector ----
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            analyticsPeriod = btn.dataset.period;
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paintAnalytics();
        });
    });

    // ---- Export ----
    document.getElementById('exportBtn').addEventListener('click', downloadCSV);
    ['exportNps', 'exportBranch'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateExportPreview);
    });

    // ---- Validator ----
    document.getElementById('validateBtn').addEventListener('click', runValidate);
    document.getElementById('validatorInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runValidate(); }
    });
    document.getElementById('markRedeemedBtn').addEventListener('click', runMarkRedeemed);
    document.getElementById('validatorClearBtn').addEventListener('click', () => {
        document.getElementById('validatorInput').value = '';
        resetValidator();
        document.getElementById('validatorInput').focus();
    });

    // ---- Modal close ----
    document.getElementById('modalClose').addEventListener('click', () => {
        document.getElementById('modalOverlay').classList.remove('show');
    });
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modalOverlay')) {
            document.getElementById('modalOverlay').classList.remove('show');
        }
    });

    // ---- Auth check on load ----
    const existingUser = await Auth.verify();
    if (existingUser) {
        await showApp(existingUser);
    } else {
        Auth.clear();
        showLogin();
    }
});
