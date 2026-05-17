// Staff history page JavaScript

class StaffHistory {
    constructor() {
        this.currentUser = null;
        this.allTickets = [];
        this.filteredTickets = [];
        this.services = [];
        this.init();
    }

    async init() {
        // Check if user is logged in
        const savedUser = utils.session.get('staff_user');
        if (!savedUser) {
            window.location.href = '/staff';
            return;
        }
        
        this.currentUser = savedUser;
        
        await this.loadServices();
        await this.loadHistory();
        this.setupEventListeners();
    }

    async loadServices() {
        try {
            this.services = await api.getServices();
            
            // Populate service filter
            const serviceFilter = document.getElementById('filter-service');
            this.services.forEach(service => {
                const option = document.createElement('option');
                option.value = service.service_id;
                option.textContent = service.name;
                serviceFilter.appendChild(option);
            });
            
        } catch (error) {
            console.error('Failed to load services:', error);
        }
    }

    async loadHistory() {
        try {
            utils.showLoading('Loading history...');
            
            // Load all tickets from all services
            let allTickets = [];
            
            for (const service of this.services) {
                try {
                    const response = await api.request(`/api/tickets/all/${service.service_id}`);
                    const ticketsWithService = response.map(ticket => ({
                        ...ticket,
                        service_name: service.name
                    }));
                    allTickets = allTickets.concat(ticketsWithService);
                } catch (error) {
                    console.error(`Failed to load tickets for service ${service.service_id}:`, error);
                }
            }
            
            // Filter only tickets that have reached a final status.
            this.allTickets = allTickets.filter(t => 
                ['completed', 'no-show', 'cancelled'].includes(t.status)
            );
            
            // Sort by created_at descending (newest first)
            this.allTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            this.applyFilters();
            
        } catch (error) {
            console.error('Failed to load history:', error);
            utils.showError('Failed to load history data.');
        } finally {
            utils.hideLoading();
        }
    }

    applyFilters() {
        const statusFilter = document.getElementById('filter-status').value;
        const dateFilter = document.getElementById('filter-date').value;
        const serviceFilter = document.getElementById('filter-service').value;
        
        this.filteredTickets = this.allTickets.filter(ticket => {
            // Status filter
            if (statusFilter !== 'all' && ticket.status !== statusFilter) {
                return false;
            }
            
            // Date filter
            if (dateFilter) {
                let ticketDate;
                if (typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')) {
                    ticketDate = new Date(ticket.created_at + ' UTC');
                } else {
                    ticketDate = new Date(ticket.created_at);
                }
                
                const filterDate = new Date(dateFilter);
                filterDate.setHours(0, 0, 0, 0);
                
                const ticketDateOnly = new Date(ticketDate);
                ticketDateOnly.setHours(0, 0, 0, 0);
                
                if (ticketDateOnly.getTime() !== filterDate.getTime()) {
                    return false;
                }
            }
            
            // Service filter
            if (serviceFilter !== 'all' && ticket.service_id !== parseInt(serviceFilter)) {
                return false;
            }
            
            return true;
        });
        
        this.renderHistory();
        this.updateStats();
    }

    renderHistory() {
        const tbody = document.getElementById('history-table-body');
        
        if (this.filteredTickets.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 2rem;">
                        No history found matching the filters
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = this.filteredTickets.map(ticket => {
            const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                ? new Date(ticket.created_at + ' UTC')
                : new Date(ticket.created_at);
            
            let completedDate = null;
            let duration = 'N/A';
            
            if (ticket.completed_at) {
                completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                    ? new Date(ticket.completed_at + ' UTC')
                    : new Date(ticket.completed_at);
                
                const durationMinutes = Math.round((completedDate - createdDate) / (1000 * 60));
                duration = utils.formatDuration(durationMinutes);
            }
            
            return `
                <tr>
                    <td>${utils.formatTicketNumber(ticket.ticket_number)}</td>
                    <td>${ticket.service_name}</td>
                    <td>${utils.getStatusBadge(ticket.status)}</td>
                    <td>${utils.formatTime(ticket.created_at)}</td>
                    <td>${completedDate ? utils.formatTime(ticket.completed_at) : 'N/A'}</td>
                    <td>${duration}</td>
                </tr>
            `;
        }).join('');
    }

    updateStats() {
        const total = this.filteredTickets.length;
        const completed = this.filteredTickets.filter(t => t.status === 'completed').length;
        const noShow = this.filteredTickets.filter(t => t.status === 'no-show').length;
        const cancelled = this.filteredTickets.filter(t => t.status === 'cancelled').length;
        
        // Calculate average duration
        const completedWithDuration = this.filteredTickets.filter(t => 
            t.status === 'completed' && t.completed_at
        );
        
        let avgDuration = 0;
        if (completedWithDuration.length > 0) {
            const totalDuration = completedWithDuration.reduce((sum, ticket) => {
                const completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                    ? new Date(ticket.completed_at + ' UTC')
                    : new Date(ticket.completed_at);
                const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                    ? new Date(ticket.created_at + ' UTC')
                    : new Date(ticket.created_at);
                const duration = (completedDate - createdDate) / (1000 * 60);
                return sum + duration;
            }, 0);
            avgDuration = Math.round(totalDuration / completedWithDuration.length);
        }
        
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-completed').textContent = completed;
        document.getElementById('stat-noshow').textContent = noShow;
        document.getElementById('stat-cancelled').textContent = cancelled;
        document.getElementById('stat-avg-duration').textContent = `${avgDuration} min`;
    }

    exportCSV() {
        if (this.filteredTickets.length === 0) {
            utils.showError('No data to export');
            return;
        }
        
        // Create CSV content
        const headers = ['Ticket Number', 'Service', 'Status', 'Created', 'Completed', 'Duration (min)'];
        const rows = this.filteredTickets.map(ticket => {
            const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                ? new Date(ticket.created_at + ' UTC')
                : new Date(ticket.created_at);
            
            let completedDate = null;
            let duration = 0;
            
            if (ticket.completed_at) {
                completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                    ? new Date(ticket.completed_at + ' UTC')
                    : new Date(ticket.completed_at);
                duration = Math.round((completedDate - createdDate) / (1000 * 60));
            }
            
            return [
                ticket.ticket_number,
                ticket.service_name,
                ticket.status,
                createdDate.toLocaleString(),
                completedDate ? completedDate.toLocaleString() : 'N/A',
                duration
            ];
        });
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        // Download CSV
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `staff-history-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        utils.showSuccess('History exported successfully!');
    }

    setupEventListeners() {
        // Apply filter button
        document.getElementById('apply-filter-btn').addEventListener('click', () => {
            this.applyFilters();
        });
        
        // Export button
        document.getElementById('export-btn').addEventListener('click', () => {
            this.exportCSV();
        });
        
        // Logout button
        document.getElementById('logout-btn').addEventListener('click', async () => {
            try {
                await api.logout();
            } catch (error) {
                console.error('Logout error:', error);
            } finally {
                utils.session.remove('staff_user');
                window.location.href = '/';
            }
        });
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    new StaffHistory();
});
