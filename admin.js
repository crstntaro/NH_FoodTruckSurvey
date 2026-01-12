// Mock data processing
const originalMockResponses = [
    { id: 1, date: '2024-07-28', receipt: 'FTPU-123456-789012', branch: 'Mendokoro Ramenba', nps: 3, reason: 'The ramen was cold and the service was slow. Very disappointed with the experience.'},
    { id: 2, date: '2024-07-28', receipt: 'FTPU-123456-112233', branch: 'Ramen Yushoken', nps: 10, reason: "Best ramen I've had in a long time! The staff was super friendly too."},
    { id: 3, date: '2024-07-27', receipt: 'FTPU-123456-445566', branch: 'Mendokoro Ramenba', nps: 8, reason: 'It was good, but nothing special. The price is a bit high for what you get.'},
    { id: 4, date: '2024-07-27', receipt: 'FTPU-123456-998877', branch: 'Ramen Yushoken', nps: 1, reason: 'Portions were too small.'},
    { id: 5, date: '2024-07-26', receipt: 'FTPU-123456-123123', branch: 'Mendokoro Ramenba', nps: 9, reason: 'Loved it!'},
    { id: 6, date: '2024-07-26', receipt: 'FTPU-123123-456456', branch: 'Ramen Yushoken', nps: 7, reason: 'It was okay.'},
    { id: 7, date: '2024-07-25', receipt: 'FTPU-123123-789789', branch: 'Mendokoro Ramenba', nps: 10, reason: 'Amazing! Will come back.'},
    { id: 8, date: '2024-07-25', receipt: 'FTPU-123123-987987', branch: 'Ramen Yushoken', nps: 5, reason: 'The queue was too long.'},
    { id: 9, date: '2024-07-24', receipt: 'FTPU-987654-111222', branch: 'Mendokoro Ramenba', nps: 2, reason: 'Staff seemed overwhelmed and were not very attentive.'},
    { id: 10, date: '2024-07-24', receipt: 'FTPU-987654-333444', branch: 'Ramen Yushoken', nps: 9, reason: 'The new gyoza is a must-try!'},
];

// Automatically create tickets for low NPS scores
const mockResponses = originalMockResponses.map(r => ({
    ...r,
    status: r.nps <= 6 ? 'open' : 'resolved'
}));


document.addEventListener('DOMContentLoaded', () => {
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
        
            function getNpsCategory(score) {
                if (score <= 6) return 'detractor';
                if (score <= 8) return 'passive';
                return 'promoter';
            }
        
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
                        <td>${res.date}</td>
                        <td>${res.receipt}</td>
                        <td>${res.branch}</td>
                        <td><span class="nps-${category}">${res.nps}</span></td>
                        <td class="comment-cell"><p class="comment-text" title="${res.reason}">${res.reason || '–'}</p></td>
                        <td class="status-cell"><span class="status-${res.status}" title="Ticket ${res.status}">${res.status}</span></td>
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
                // Summary cards
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
        
                // NPS Chart
                const npsChartData = {
                    labels: ['Promoters', 'Passives', 'Detractors'],
                    datasets: [{
                        label: 'NPS Distribution',
                        data: [promoters, passives, detractors],
                        backgroundColor: ['var(--nps-promoter-color)','var(--nps-passive-color)','var(--nps-detractor-color)'],
                        borderWidth: 0,
                    }]
                };
                if (npsChartCtx) { // Only attempt to create/update if context is available
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

                // Branch Chart
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

                if(branchChartCtx) { // Only attempt to create/update if context is available
                    if(branchChart) {
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
        
            function applyFilters() {
                const searchTerm = searchInput.value.toLowerCase();
                const startDate = dateStartInput.value;
                const endDate = dateEndInput.value;
                const ticketStatus = ticketStatusInput.value;
                const npsGroup = npsInput.value;
                const branch = branchInput.value;
        
                let filtered = mockResponses;
        
                if (searchTerm) {
                    filtered = filtered.filter(r => r.reason.toLowerCase().includes(searchTerm));
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
                    filtered = filtered.filter(r => getNpsCategory(r.nps) === npsGroup);
                }
                if (branch !== 'all') {
                    filtered = filtered.filter(r => r.branch === branch);
                }
                
                renderTable(filtered);
                updateDashboard(filtered);
            }
            
            function debounce(func, delay) {
                let timeout;
                return function(...args) {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => func.apply(this, args), delay);
                };
            }
        
            applyFiltersBtn.addEventListener('click', applyFilters);
            searchInput.addEventListener('input', debounce(applyFilters, 300));
        
            // Initial render
            ticketStatusInput.value = 'open';
            applyFilters();
        });