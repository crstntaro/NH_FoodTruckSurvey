// Supabase config (same instance as the survey form)
const SUPABASE_URL = 'https://xkzicpfxlvgovugumspr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhremljcGZ4bHZnb3Z1Z3Vtc3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyODI1MzAsImV4cCI6MjA3Mjg1ODUzMH0.8xykX92QwVWccQyOz60ONb_CirdbGcKvQD8FjO8RJrA';

let sb = null;
let allResponses = [];

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

// Transform a Supabase row into a flat response object for the dashboard
function transformRow(row) {
    const sd = row.survey_data || {};
    const nps = sd.q8_nps !== undefined ? Number(sd.q8_nps) : null;
    const reason = sd.q8_comment || '';

    // Determine branch from survey_data (q3_branch) or fallback
    const branch = sd.q3_branch || row.brand || 'Unknown';

    return {
        id: row.id,
        date: row.completed_at ? row.completed_at.slice(0, 10) : (row.created_at ? row.created_at.slice(0, 10) : '-'),
        receipt: row.receipt_no || '-',
        branch: branch,
        name: row.name || '-',
        email: row.email || '',
        nps: nps,
        reason: reason,
        status: row.status === 'completed' ? (nps !== null && nps <= 6 ? 'open' : 'resolved') : (row.status || 'pending'),
        raw: row
    };
}

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

document.addEventListener('DOMContentLoaded', async () => {
    // Init Supabase
    if (window.supabase?.createClient) {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // DOM Elements
    const tableBody = document.getElementById('responses-table-body');
    const totalResponsesEl = document.getElementById('total-responses');
    const overallNpsEl = document.getElementById('overall-nps');
    const totalPromotersEl = document.getElementById('total-promoters');
    const totalPassivesEl = document.getElementById('total-passives');
    const totalDetractorsEl = document.getElementById('total-detractors');
    const totalTicketsEl = document.getElementById('total-tickets');
    const filterToggleBtn = document.getElementById('filter-toggle');
    const filterPanel = document.getElementById('filter-panel');
    const menuToggle = document.getElementById('menu-toggle');
    const sideNavOverlay = document.getElementById('side-nav-overlay');
    const searchInput = document.getElementById('filter-search');
    const dateStartInput = document.getElementById('filter-date-start');
    const dateEndInput = document.getElementById('filter-date-end');
    const ticketStatusInput = document.getElementById('filter-ticket-status');
    const npsInput = document.getElementById('filter-nps');
    const branchInput = document.getElementById('filter-branch');
    const applyFiltersBtn = document.getElementById('apply-filters');

    // Chart contexts
    const npsChartEl = document.getElementById('nps-chart');
    const npsChartCtx = npsChartEl ? npsChartEl.getContext('2d') : null;
    const branchChartEl = document.getElementById('branch-chart');
    const branchChartCtx = branchChartEl ? branchChartEl.getContext('2d') : null;
    let npsChart, branchChart;

    // Side Nav Toggle
    menuToggle.addEventListener('click', () => {
        document.body.classList.toggle('side-nav-open');
    });
    sideNavOverlay.addEventListener('click', () => {
        document.body.classList.remove('side-nav-open');
    });

    // Toggle filter panel
    filterToggleBtn.addEventListener('click', () => {
        filterPanel.classList.toggle('open');
        filterToggleBtn.classList.toggle('active');
    });

    function renderTable(responses) {
        tableBody.innerHTML = '';
        if (responses.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted);">No responses match filters.</td></tr>`;
            return;
        }

        responses.forEach(res => {
            const category = getNpsCategory(res.nps);
            const row = document.createElement('tr');
            row.className = res.status === 'open' ? 'ticket-open' : '';

            row.innerHTML = `
                <td>${escapeHtml(res.date)}</td>
                <td>${escapeHtml(res.receipt)}</td>
                <td>${escapeHtml(res.branch)}</td>
                <td><span class="nps-${category}">${res.nps !== null ? res.nps : '-'}</span></td>
                <td class="comment-cell"><p class="comment-text" title="${escapeHtml(res.reason)}">${escapeHtml(res.reason) || '–'}</p></td>
                <td class="status-cell"><span class="status-${res.status}" title="Ticket ${res.status}">${escapeHtml(res.status)}</span></td>
                <td class="actions-cell">
                    <button title="${res.status === 'open' ? 'Resolve Ticket' : 'Re-open Ticket'}">
                        ${res.status === 'open'
                            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>`
                            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2.5a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 0110 2.5z" /></svg>`
                        }
                    </button>
                </td>
            `;
            row.querySelector('button').addEventListener('click', () => {
                res.status = res.status === 'open' ? 'resolved' : 'open';
                applyFilters();
            });
            tableBody.appendChild(row);
        });
    }

    function updateDashboard(responses) {
        const total = responses.length;
        const promoters = responses.filter(r => getNpsCategory(r.nps) === 'promoter').length;
        const passives = responses.filter(r => getNpsCategory(r.nps) === 'passive').length;
        const detractors = responses.filter(r => getNpsCategory(r.nps) === 'detractor').length;
        const openTickets = responses.filter(r => r.status === 'open').length;
        const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

        totalResponsesEl.textContent = total;
        overallNpsEl.textContent = npsScore;
        totalPromotersEl.textContent = promoters;
        totalPassivesEl.textContent = passives;
        totalDetractorsEl.textContent = detractors;
        totalTicketsEl.textContent = openTickets;

        if (npsScore > 20) overallNpsEl.className = 'card-value nps-promoter';
        else if (npsScore < 0) overallNpsEl.className = 'card-value nps-detractor';
        else overallNpsEl.className = 'card-value nps-passive';

        // Chart colors resolved from CSS vars
        const styles = getComputedStyle(document.documentElement);
        const promoterColor = styles.getPropertyValue('--nps-promoter-color').trim() || '#15803d';
        const passiveColor = styles.getPropertyValue('--nps-passive-color').trim() || '#d97706';
        const detractorColor = styles.getPropertyValue('--nps-detractor-color').trim() || '#b91c1c';

        // NPS Doughnut Chart
        const npsChartData = {
            labels: ['Promoters', 'Passives', 'Detractors'],
            datasets: [{
                label: 'NPS Distribution',
                data: [promoters, passives, detractors],
                backgroundColor: [promoterColor, passiveColor, detractorColor],
                borderWidth: 0,
            }]
        };
        if (npsChartCtx) {
            if (npsChart) {
                npsChart.data = npsChartData;
                npsChart.update();
            } else {
                npsChart = new Chart(npsChartCtx, {
                    type: 'doughnut',
                    data: npsChartData,
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
                });
            }
        }

        // Branch Bar Chart
        const branches = [...new Set(responses.map(r => r.branch))];
        const branchData = branches.map(branch => responses.filter(r => r.branch === branch).length);
        const branchChartData = {
            labels: branches,
            datasets: [{
                label: 'Responses by Branch',
                data: branchData,
                backgroundColor: 'rgba(14, 155, 164, 0.7)',
            }]
        };
        if (branchChartCtx) {
            if (branchChart) {
                branchChart.data = branchChartData;
                branchChart.update();
            } else {
                branchChart = new Chart(branchChartCtx, {
                    type: 'bar',
                    data: branchChartData,
                    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
                });
            }
        }
    }

    function populateBranchFilter() {
        const branches = [...new Set(allResponses.map(r => r.branch))].sort();
        // Clear existing options except "All Branches"
        branchInput.innerHTML = '<option value="all">All Branches</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            branchInput.appendChild(opt);
        });
    }

    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase();
        const startDate = dateStartInput.value;
        const endDate = dateEndInput.value;
        const ticketStatus = ticketStatusInput.value;
        const npsGroup = npsInput.value;
        const branch = branchInput.value;

        let filtered = allResponses;

        if (searchTerm) {
            filtered = filtered.filter(r => (r.reason || '').toLowerCase().includes(searchTerm));
        }
        if (startDate) {
            filtered = filtered.filter(r => r.date >= startDate);
        }
        if (endDate) {
            filtered = filtered.filter(r => r.date <= endDate);
        }
        if (ticketStatus !== 'all') {
            filtered = filtered.filter(r => r.status === ticketStatus);
        }
        if (npsGroup !== 'all') {
            const groupMap = { detractors: 'detractor', passives: 'passive', promoters: 'promoter' };
            filtered = filtered.filter(r => getNpsCategory(r.nps) === (groupMap[npsGroup] || npsGroup));
        }
        if (branch !== 'all') {
            filtered = filtered.filter(r => r.branch === branch);
        }

        renderTable(filtered);
        updateDashboard(filtered);
    }

    function debounce(func, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    applyFiltersBtn.addEventListener('click', applyFilters);
    searchInput.addEventListener('input', debounce(applyFilters, 300));

    // Show loading state
    tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted);">Loading responses...</td></tr>`;

    // Fetch real data
    allResponses = await fetchResponses();

    if (allResponses.length === 0 && !sb) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted);">Could not connect to database. Check Supabase configuration.</td></tr>`;
        return;
    }

    populateBranchFilter();
    ticketStatusInput.value = 'all';
    applyFilters();
});
