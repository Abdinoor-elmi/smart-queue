class ManagerReports {
    constructor() {
        this.currentUser = null;
        this.services = [];
        this.counters = [];
        this.tickets = [];
        this.currentReport = null;
        this.init();
    }

    async init() {
        const savedUser = utils.session.get('manager_user');
        if (savedUser && (savedUser.role_name === 'manager' || savedUser.role_name === 'admin')) {
            this.currentUser = savedUser;
            this.showDashboard();
            await this.loadFilters();
        } else {
            this.showLogin();
        }

        this.setupEventListeners();
    }

    showLogin() {
        document.getElementById('login-modal').classList.add('show');
    }

    hideLogin() {
        document.getElementById('login-modal').classList.remove('show');
    }

    showDashboard() {
        document.getElementById('manager-main').style.display = 'block';
        document.getElementById('manager-user').textContent = this.currentUser.username;
        this.setDefaultDates();
    }

    async login(username, password) {
        try {
            utils.showLoading('Logging in...');
            const response = await api.login(username, password);
            const role = response.user.role_name;

            if (role !== 'manager' && role !== 'admin') {
                throw new Error('Manager access required');
            }

            this.currentUser = response.user;
            utils.session.set('manager_user', this.currentUser);
            this.hideLogin();
            this.showDashboard();
            await this.loadFilters();
        } catch (error) {
            utils.showError('Manager login failed. Please check your credentials.');
        } finally {
            utils.hideLoading();
        }
    }

    async logout() {
        try {
            await api.logout();
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            utils.session.remove('manager_user');
            window.location.reload();
        }
    }

    async loadFilters() {
        try {
            this.services = await api.getServices();
            this.counters = await api.getCounters();
            this.populateFilters();
        } catch (error) {
            this.handleLoadError(error);
        }
    }

    populateFilters() {
        const serviceSelect = document.getElementById('service-filter');
        serviceSelect.innerHTML = '<option value="all">All Services</option>' +
            this.services.map(service => `<option value="${service.service_id}">${this.escapeHtml(service.name)}</option>`).join('');

        const counterSelect = document.getElementById('counter-filter');
        counterSelect.innerHTML = '<option value="all">All Counters</option>' +
            this.counters.map(counter => `<option value="${counter.counter_id}">${this.escapeHtml(counter.name)} - ${this.escapeHtml(counter.service_name)}</option>`).join('');
    }

    setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('from-date').value = today;
        document.getElementById('to-date').value = today;
    }

    async generateReport() {
        try {
            utils.showLoading('Generating report...');
            this.tickets = await this.loadAllTickets();

            const reportType = document.getElementById('report-type').value;
            const tickets = this.getFilteredTickets();

            const renderers = {
                summary: () => this.renderSummaryReport(tickets),
                queue: () => this.renderQueueReport(tickets),
                service: () => this.renderServiceReport(tickets),
                counter: () => this.renderCounterReport(tickets),
                peak: () => this.renderPeakHoursReport(tickets),
                noshow: () => this.renderNoShowReport(tickets),
                tickets: () => this.renderTicketDetailsReport(tickets)
            };

            renderers[reportType]();
        } catch (error) {
            this.handleLoadError(error);
        } finally {
            utils.hideLoading();
        }
    }

    async loadAllTickets() {
        const allTickets = [];

        for (const service of this.services) {
            const tickets = await api.request(`/api/tickets/all/${service.service_id}`);
            allTickets.push(...tickets.map(ticket => ({
                ...ticket,
                service_name: service.name
            })));
        }

        return allTickets;
    }

    getFilteredTickets() {
        const serviceId = document.getElementById('service-filter').value;
        const counterId = document.getElementById('counter-filter').value;
        const fromDate = document.getElementById('from-date').value;
        const toDate = document.getElementById('to-date').value;

        const from = fromDate ? new Date(`${fromDate}T00:00:00`) : null;
        const to = toDate ? new Date(`${toDate}T23:59:59`) : null;

        return this.tickets.filter(ticket => {
            const created = this.parseDate(ticket.created_at);
            if (from && created < from) return false;
            if (to && created > to) return false;
            if (serviceId !== 'all' && ticket.service_id !== Number(serviceId)) return false;
            if (counterId !== 'all' && Number(ticket.counter_id) !== Number(counterId)) return false;
            return true;
        });
    }

    renderSummaryReport(tickets) {
        const completed = tickets.filter(ticket => ticket.status === 'completed').length;
        const noShow = tickets.filter(ticket => ticket.status === 'no-show').length;
        const cancelled = tickets.filter(ticket => ticket.status === 'cancelled').length;
        const active = tickets.filter(ticket => ['waiting', 'called', 'serving'].includes(ticket.status)).length;
        const completionRate = tickets.length ? Math.round((completed / tickets.length) * 100) : 0;
        const exportRows = [
            ['Metric', 'Value'],
            ['Total Tickets', tickets.length],
            ['Completed', completed],
            ['Active', active],
            ['No-Show', noShow],
            ['Cancelled', cancelled],
            ['Waiting to be called', tickets.filter(t => t.status === 'waiting').length],
            ['Called, awaiting service', tickets.filter(t => t.status === 'called').length],
            ['Being served', tickets.filter(t => t.status === 'serving').length],
            ['Completion Rate', `${completionRate}%`]
        ];

        this.setReportContent('Summary Report', `
            <div class="dashboard-overview">
                <div class="overview-card"><div class="overview-title">Total Tickets</div><div class="overview-value">${tickets.length}</div></div>
                <div class="overview-card success"><div class="overview-title">Completed</div><div class="overview-value">${completed}</div></div>
                <div class="overview-card warning"><div class="overview-title">Active</div><div class="overview-value">${active}</div></div>
                <div class="overview-card danger"><div class="overview-title">No-Show</div><div class="overview-value">${noShow}</div></div>
                <div class="overview-card"><div class="overview-title">Cancelled</div><div class="overview-value">${cancelled}</div></div>
            </div>
            <table class="data-table">
                <tbody>
                    <tr><td>Completion Rate</td><td>${completionRate}%</td></tr>
                    <tr><td>Waiting to be called</td><td>${tickets.filter(t => t.status === 'waiting').length}</td></tr>
                    <tr><td>Called, awaiting service</td><td>${tickets.filter(t => t.status === 'called').length}</td></tr>
                    <tr><td>Being served</td><td>${tickets.filter(t => t.status === 'serving').length}</td></tr>
                </tbody>
            </table>
        `, exportRows);
    }

    renderQueueReport(tickets) {
        const activeTickets = tickets.filter(ticket => ['waiting', 'called', 'serving'].includes(ticket.status));
        this.setTicketReportContent('Active Queue Report', activeTickets);
    }

    renderServiceReport(tickets) {
        const rows = this.services.map(service => {
            const serviceTickets = tickets.filter(ticket => ticket.service_id === service.service_id);
            const completed = serviceTickets.filter(ticket => ticket.status === 'completed').length;
            const noShow = serviceTickets.filter(ticket => ticket.status === 'no-show').length;
            const cancelled = serviceTickets.filter(ticket => ticket.status === 'cancelled').length;
            const rate = serviceTickets.length ? Math.round((completed / serviceTickets.length) * 100) : 0;

            return `
                <tr>
                    <td>${this.escapeHtml(service.name)}</td>
                    <td>${serviceTickets.length}</td>
                    <td>${completed}</td>
                    <td>${noShow}</td>
                    <td>${cancelled}</td>
                    <td>${rate}%</td>
                </tr>
            `;
        }).join('');
        const exportRows = [
            ['Service', 'Total', 'Completed', 'No-Show', 'Cancelled', 'Completion Rate'],
            ...this.services.map(service => {
                const serviceTickets = tickets.filter(ticket => ticket.service_id === service.service_id);
                const completed = serviceTickets.filter(ticket => ticket.status === 'completed').length;
                const noShow = serviceTickets.filter(ticket => ticket.status === 'no-show').length;
                const cancelled = serviceTickets.filter(ticket => ticket.status === 'cancelled').length;
                const rate = serviceTickets.length ? Math.round((completed / serviceTickets.length) * 100) : 0;
                return [service.name, serviceTickets.length, completed, noShow, cancelled, `${rate}%`];
            })
        ];

        this.setReportContent('Service Performance Report', `
            <table class="data-table">
                <thead><tr><th>Service</th><th>Total</th><th>Completed</th><th>No-Show</th><th>Cancelled</th><th>Completion Rate</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" style="text-align:center;">No data</td></tr>'}</tbody>
            </table>
        `, exportRows);
    }

    renderCounterReport(tickets) {
        const rows = this.counters.map(counter => {
            const counterTickets = tickets.filter(ticket => Number(ticket.counter_id) === counter.counter_id);
            return `
                <tr>
                    <td>${this.escapeHtml(counter.name)}</td>
                    <td>${this.escapeHtml(counter.service_name)}</td>
                    <td>${counterTickets.length}</td>
                    <td>${counterTickets.filter(t => t.status === 'serving').length}</td>
                    <td>${counterTickets.filter(t => t.status === 'completed').length}</td>
                </tr>
            `;
        }).join('');
        const exportRows = [
            ['Counter', 'Service', 'Total Assigned', 'Serving', 'Completed'],
            ...this.counters.map(counter => {
                const counterTickets = tickets.filter(ticket => Number(ticket.counter_id) === counter.counter_id);
                return [
                    counter.name,
                    counter.service_name,
                    counterTickets.length,
                    counterTickets.filter(t => t.status === 'serving').length,
                    counterTickets.filter(t => t.status === 'completed').length
                ];
            })
        ];

        this.setReportContent('Counter Activity Report', `
            <table class="data-table">
                <thead><tr><th>Counter</th><th>Service</th><th>Total Assigned</th><th>Serving</th><th>Completed</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No data</td></tr>'}</tbody>
            </table>
        `, exportRows);
    }

    renderNoShowReport(tickets) {
        this.setTicketReportContent('No-Show Report', tickets.filter(ticket => ticket.status === 'no-show'));
    }

    renderTicketDetailsReport(tickets) {
        this.setTicketReportContent('Ticket Details Report', tickets);
    }

    renderPeakHoursReport(tickets) {
        const hours = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            total: 0,
            completed: 0,
            noShow: 0,
            cancelled: 0
        }));

        tickets.forEach(ticket => {
            const created = this.parseDate(ticket.created_at);
            if (Number.isNaN(created.getTime())) return;
            const hour = Number(created.toLocaleString('en-KE', {
                hour: '2-digit',
                hour12: false,
                timeZone: 'Africa/Nairobi'
            }));
            if (!Number.isInteger(hour)) return;
            hours[hour].total += 1;
            if (ticket.status === 'completed') hours[hour].completed += 1;
            if (ticket.status === 'no-show') hours[hour].noShow += 1;
            if (ticket.status === 'cancelled') hours[hour].cancelled += 1;
        });

        const visibleHours = hours.filter(row => row.total > 0);
        const rows = visibleHours.map(row => `
            <tr>
                <td>${String(row.hour).padStart(2, '0')}:00 - ${String(row.hour).padStart(2, '0')}:59</td>
                <td>${row.total}</td>
                <td>${row.completed}</td>
                <td>${row.noShow}</td>
                <td>${row.cancelled}</td>
            </tr>
        `).join('');

        this.setReportContent('Peak Hours Report', `
            <table class="data-table">
                <thead><tr><th>Hour</th><th>Total Tickets</th><th>Completed</th><th>No-Show</th><th>Cancelled</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" style="text-align:center;">No data</td></tr>'}</tbody>
            </table>
        `, [
            ['Hour', 'Total Tickets', 'Completed', 'No-Show', 'Cancelled'],
            ...visibleHours.map(row => [
                `${String(row.hour).padStart(2, '0')}:00`,
                row.total,
                row.completed,
                row.noShow,
                row.cancelled
            ])
        ]);
    }

    setTicketReportContent(title, tickets) {
        this.setReportContent(title, this.renderTicketTable(tickets), this.getTicketExportRows(tickets));
    }

    renderTicketTable(tickets) {
        if (tickets.length === 0) {
            return `
                <div class="empty-report-state">
                    <div class="empty-report-title">No tickets found</div>
                    <p>No records match the selected report filters.</p>
                </div>
            `;
        }

        const rows = tickets
            .sort((a, b) => this.parseDate(b.created_at) - this.parseDate(a.created_at))
            .map(ticket => `
                <tr>
                    <td>${this.escapeHtml(ticket.ticket_number)}</td>
                    <td>${this.escapeHtml(ticket.service_name)}</td>
                    <td>${utils.getStatusBadge(ticket.status)}</td>
                    <td>${this.escapeHtml(this.getCounterName(ticket))}</td>
                    <td>${utils.formatTime(ticket.created_at)}</td>
                </tr>
            `).join('');

        return `
            <table class="data-table">
                <thead><tr><th>Ticket #</th><th>Service</th><th>Status</th><th>Counter</th><th>Created</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    setReportContent(title, content, exportRows = []) {
        this.currentReport = { title, rows: exportRows };
        const exportButton = document.getElementById('export-report-btn');
        if (exportButton) {
            exportButton.disabled = exportRows.length === 0;
        }
        const pdfButton = document.getElementById('export-pdf-btn');
        if (pdfButton) {
            pdfButton.disabled = exportRows.length === 0;
        }

        document.getElementById('report-output').innerHTML = `
            <div class="chart-header">
                <div class="chart-title">${this.escapeHtml(title)}</div>
            </div>
            <div class="chart-content">${content}</div>
        `;
    }

    getTicketExportRows(tickets) {
        return [
            ['Ticket Number', 'Service', 'Status', 'Counter', 'Created', 'Called', 'Served', 'Completed', 'Missed Calls'],
            ...tickets.map(ticket => [
                ticket.ticket_number,
                ticket.service_name,
                ticket.status,
                this.getCounterName(ticket),
                this.formatDateTime(ticket.created_at),
                this.formatDateTime(ticket.called_at),
                this.formatDateTime(ticket.served_at),
                this.formatDateTime(ticket.completed_at),
                ticket.missed_calls || 0
            ])
        ];
    }

    exportCurrentReport() {
        if (!this.currentReport || !this.currentReport.rows.length) {
            utils.showError('Generate a report before exporting.');
            return;
        }

        const csv = this.currentReport.rows
            .map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        const filename = this.currentReport.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'manager-report';

        link.href = url;
        link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        utils.showSuccess('Report exported successfully.');
    }

    exportCurrentReportAsPdf() {
        if (!this.currentReport || !this.currentReport.rows.length) {
            utils.showError('Generate a report before exporting.');
            return;
        }
        window.print();
    }

    getCounterName(ticket) {
        const counterId = Number(ticket.counter_id);
        if (!counterId) return '-';
        const counter = this.counters.find(item => item.counter_id === counterId);
        return counter ? counter.name : `Counter ${counterId}`;
    }

    parseDate(value) {
        if (typeof value === 'string' && !value.endsWith('Z') && value.includes(' ')) {
            return new Date(`${value} UTC`);
        }
        return new Date(value);
    }

    formatDateTime(value) {
        if (!value) return '';
        const date = this.parseDate(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleString('en-KE', {
            timeZone: 'Africa/Nairobi',
            hour12: false
        });
    }

    resetReport() {
        document.getElementById('report-form').reset();
        this.setDefaultDates();
        this.setReportContent('Report Output', `
            <div class="empty-report-state">
                <div class="empty-report-title">No report generated yet</div>
                <p>Choose a report type and click Generate Report.</p>
            </div>
        `);
    }

    handleLoadError(error) {
        if (error.status === 401) {
            utils.session.remove('manager_user');
            this.currentUser = null;
            this.showLogin();
            utils.showError('Your manager session expired. Please log in again.');
            return;
        }

        console.error('Manager report error:', error);
        utils.showError('Failed to load manager report.');
    }

    setupEventListeners() {
        document.getElementById('login-form').addEventListener('submit', (event) => {
            event.preventDefault();
            this.login(
                document.getElementById('username').value,
                document.getElementById('password').value
            );
        });

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('report-form').addEventListener('submit', (event) => {
            event.preventDefault();
            this.generateReport();
        });
        document.getElementById('reset-report-btn').addEventListener('click', () => this.resetReport());
        document.getElementById('export-report-btn').addEventListener('click', () => this.exportCurrentReport());
        document.getElementById('export-pdf-btn').addEventListener('click', () => this.exportCurrentReportAsPdf());
    }

    escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ManagerReports();
});
