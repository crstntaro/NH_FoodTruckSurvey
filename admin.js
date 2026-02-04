// ============================================================
//  Food Truck Survey — Admin Dashboard
//  Connects to Supabase, renders overview, responses,
//  analytics, and export tabs with full NPS management.
// ============================================================

const SUPABASE_URL = 'https://xkzicpfxlvgovugumspr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhremljcGZ4bHZnb3Z1Z3Vtc3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyODI1MzAsImV4cCI6MjA3Mjg1ODUzMH0.8xykX92QwVWccQyOz60ONb_CirdbGcKvQD8FjO8RJrA';

let sb = null;
let allResponses = [];
let overviewNpsCat = 'detractors';
let charts = {};

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

function humanAgo(dateStr) {
    if (!dateStr) return '-';
    const ms = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    return '<1h';
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
//  Data Transformation
// ============================================================

function transformRow(row) {
    const sd = row.survey_data || {};
    const nps = sd.q8_nps !== undefined && sd.q8_nps !== null ? Number(sd.q8_nps) : null;
    const branch = sd.q3_branch || row.brand || 'Unknown';

    // Determine ticket status: use DB column if exists, else derive from NPS
    let ticketStatus = row.ticket_status;
    if (!ticketStatus) {
        ticketStatus = (nps !== null && nps <= 6) ? 'open' : 'resolved';
    }

    return {
        id: row.id,
        date: row.completed_at ? row.completed_at.slice(0, 10) : (row.created_at ? row.created_at.slice(0, 10) : '-'),
        completedAt: row.completed_at || row.created_at,
        receipt: row.receipt_no || '-',
        branch: branch,
        name: row.name || '-',
        email: row.email || '',
        phone: row.contact_number || '',
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
        // Still update locally even if DB update fails (column might not exist yet)
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

    // Avg food rating
    const foodRatings = allResponses.filter(r => r.food !== null).map(r => r.food);
    const avgFood = foodRatings.length > 0 ? (foodRatings.reduce((a, b) => a + b, 0) / foodRatings.length).toFixed(1) : '-';

    // KPIs
    document.getElementById('kpiCritical').textContent = critical.length;
    document.getElementById('kpiDetractors').textContent = detractors.length - critical.length;
    document.getElementById('kpiOpenTickets').textContent = openTickets.length;
    document.getElementById('kpiPromoterCount').textContent = promoters.length;
    document.getElementById('kpiAvgFood').textContent = avgFood;

    // NPS Summary
    const npsData = calculateNPS(allResponses);
    const npsScoreEl = document.getElementById('overviewNpsScore');
    npsScoreEl.textContent = npsData.score;
    npsScoreEl.style.color = npsData.score > 0 ? 'var(--ok)' : npsData.score < 0 ? 'var(--bad)' : 'var(--warn)';

    document.getElementById('overviewPromotersPct').textContent = `${npsData.total ? Math.round((npsData.promoters / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewPassivesPct').textContent = `${npsData.total ? Math.round((npsData.passives / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewDetractorsPct').textContent = `${npsData.total ? Math.round((npsData.detractors / npsData.total) * 100) : 0}%`;
    document.getElementById('overviewTotal').textContent = npsData.total;

    // Button counts
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
        emptyMsg = 'No detractors found! Great job!';
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
                <td>${agingBadge(r.completedAt, r.ticketStatus)}</td>
                <td>${npsBadge(r.nps)}</td>
                <td>${escapeHtml(r.branch)}</td>
                <td>${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
                <td style="max-width:200px">${escapeHtml(r.npsComment) || '-'}</td>
                <td><span class="aging-badge ${priorityBadgeClass(priority)}">${priority}</span></td>
                <td>${statusSelectHtml(r.ticketStatus, r.id)}</td>
                <td><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${agingBadge(r.completedAt, r.ticketStatus)}</td>
                <td>${npsBadge(r.nps)}</td>
                <td>${escapeHtml(r.branch)}</td>
                <td>${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
                <td style="max-width:200px">${escapeHtml(r.npsComment) || '-'}</td>
                <td>${statusSelectHtml(r.ticketStatus, r.id)}</td>
                <td><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
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
            <td>${escapeHtml(r.date)}</td>
            <td>${npsBadge(r.nps)}</td>
            <td>${escapeHtml(r.branch)}</td>
            <td>${escapeHtml(r.name)}<br><small style="color:var(--muted)">${escapeHtml(r.email)}</small></td>
            <td style="max-width:180px">${escapeHtml(r.npsComment) || '-'}</td>
            <td>${r.food !== null ? `<strong>${r.food}</strong>/10` : '-'}</td>
            <td>${r.service !== null ? `<strong>${r.service}</strong>/10` : '-'}</td>
            <td>${r.price !== null ? `<strong>${r.price}</strong>/10` : '-'}</td>
            <td>${statusSelectHtml(r.ticketStatus, r.id)}</td>
            <td><button class="btn btn-sm btn-outline" data-view="${escapeHtml(r.id)}">View</button></td>
        `;
        tbody.appendChild(tr);
    });

    attachStatusHandlers(tbody);
    attachViewHandlers(tbody);
}

// ============================================================
//  Analytics Tab
// ============================================================

function paintAnalytics() {
    const styles = getComputedStyle(document.documentElement);
    const ok = styles.getPropertyValue('--ok').trim() || '#15803d';
    const warn = styles.getPropertyValue('--warn').trim() || '#d97706';
    const bad = styles.getPropertyValue('--bad').trim() || '#b91c1c';
    const accent = styles.getPropertyValue('--accent').trim() || '#0e9ba4';

    const npsData = calculateNPS(allResponses);

    // NPS Distribution Doughnut
    renderChart('chartNpsDist', 'doughnut', {
        labels: ['Promoters', 'Passives', 'Detractors'],
        datasets: [{ data: [npsData.promoters, npsData.passives, npsData.detractors], backgroundColor: [ok, warn, bad], borderWidth: 0 }]
    }, { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } });

    // Responses by Branch
    const branches = [...new Set(allResponses.map(r => r.branch))];
    const branchCounts = branches.map(b => allResponses.filter(r => r.branch === b).length);
    renderChart('chartBranch', 'bar', {
        labels: branches,
        datasets: [{ label: 'Responses', data: branchCounts, backgroundColor: accent + 'b3' }]
    }, { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } });

    // Average Ratings Radar
    const avgOf = (arr) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;
    const foods = allResponses.filter(r => r.food !== null).map(r => r.food);
    const services = allResponses.filter(r => r.service !== null).map(r => r.service);
    const prices = allResponses.filter(r => r.price !== null).map(r => r.price);
    renderChart('chartRatings', 'radar', {
        labels: ['Food', 'Service', 'Price'],
        datasets: [{ label: 'Average Rating', data: [avgOf(foods), avgOf(services), avgOf(prices)], backgroundColor: accent + '33', borderColor: accent, pointBackgroundColor: accent, borderWidth: 2 }]
    }, { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 10 } }, plugins: { legend: { display: false } } });

    // Response Trend (Last 30 days)
    const now = new Date();
    const labels = [];
    const counts = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        labels.push(d.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
        counts.push(allResponses.filter(r => r.date === key).length);
    }
    renderChart('chartTrend', 'line', {
        labels: labels,
        datasets: [{ label: 'Responses', data: counts, borderColor: accent, backgroundColor: accent + '1a', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 2 }]
    }, { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 10 } } } });
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

    const headers = ['Date', 'Receipt', 'Branch', 'Name', 'Email', 'Phone', 'NPS', 'NPS Category', 'NPS Comment', 'Food Rating', 'Food Comment', 'Service Rating', 'Service Comment', 'Price Rating', 'Price Comment', 'Enjoy Experience', 'Discovery', 'Spend', 'Cuisines', 'Return Intention', 'Ticket Status'];

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
            r.returnIntention, r.ticketStatus
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

    // Paint tab-specific content
    if (tabName === 'overview') paintOverview();
    if (tabName === 'responses') paintResponses();
    if (tabName === 'analytics') paintAnalytics();
    if (tabName === 'export') updateExportPreview();
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
//  Init
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Supabase init
    if (window.supabase?.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // Sidebar navigation
    document.querySelectorAll('.sidebar-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
            setTab(tab.dataset.tab);
            // Close mobile sidebar
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('visible');
        });
    });

    // Mobile menu
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

    // NPS category buttons (overview)
    document.querySelectorAll('.nps-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            overviewNpsCat = btn.dataset.npsCat;
            document.querySelectorAll('.nps-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paintOverviewTable();
        });
    });

    // Response filters
    const debouncedPaint = debounce(paintResponses, 300);
    document.getElementById('respSearch').addEventListener('input', debouncedPaint);
    ['respDateStart', 'respDateEnd', 'respNps', 'respBranch', 'respStatus'].forEach(id => {
        document.getElementById(id).addEventListener('change', paintResponses);
    });

    // Export
    document.getElementById('exportBtn').addEventListener('click', downloadCSV);
    ['exportNps', 'exportBranch'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateExportPreview);
    });

    // Modal close
    document.getElementById('modalClose').addEventListener('click', () => {
        document.getElementById('modalOverlay').classList.remove('show');
    });
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('modalOverlay')) {
            document.getElementById('modalOverlay').classList.remove('show');
        }
    });

    // Show loading
    document.getElementById('overviewBody').innerHTML = '<tr><td colspan="8"><div class="empty"><div class="spinner"></div><br>Loading responses...</div></td></tr>';

    // Fetch data
    allResponses = await fetchResponses();
    populateBranchDropdowns();

    if (allResponses.length === 0 && !sb) {
        document.getElementById('overviewBody').innerHTML = '<tr><td colspan="8"><div class="empty">Could not connect to database. Check Supabase configuration.</div></td></tr>';
        return;
    }

    // Paint default tab
    setTab('overview');
});
