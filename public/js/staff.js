// Staff dashboard JavaScript

class StaffDashboard {
    constructor() {
        this.currentUser = null;
        this.currentTicket = null;
        this.queue = [];
        this.counters = [];
        this.selectedCounter = null;
        this.autoCallEnabled = utils.storage.get('staff_auto_call_enabled', true);
        this.init();
    }

    async init() {
        // Check if user is logged in
        const savedUser = utils.session.get('staff_user');
        if (savedUser) {
            this.currentUser = savedUser;
            this.showStaffInterface();
            await this.loadDashboard();
        } else {
            this.showLoginModal();
        }

        this.setupEventListeners();
        this.setupWebSocketHandlers();
        this.startPeriodicUpdates();
    }

    showLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.classList.remove('hidden');
    }

    hideLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.style.display = 'none';
    }

    showStaffInterface() {
        document.getElementById('staff-container').style.display = 'block';
    }

    async login(username, password) {
        try {
            utils.showLoading('Logging in...');
            
            const response = await api.login(username, password);
            
            if (response.success) {
                this.currentUser = response.user;
                utils.session.set('staff_user', this.currentUser);
                
                this.hideLoginModal();
                this.showStaffInterface();
                await this.loadDashboard();
                
                utils.showSuccess('Login successful!');
            }
        } catch (error) {
            console.error('Login failed:', error);
            utils.showError('Login failed. Please check your credentials.');
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
            utils.session.remove('staff_user');
            this.currentUser = null;
            window.location.reload();
        }
    }

    async loadDashboard() {
        try {
            utils.showLoading('Loading dashboard...');
            
            // Load counters and select first available
            await this.loadCounters();
            await this.loadQueue();
            await this.updateMetrics();
            
        } catch (error) {
            console.error('Failed to load dashboard:', error);
            utils.showError('Failed to load dashboard data.');
        } finally {
            utils.hideLoading();
        }
    }

    async loadCounters() {
        try {
            this.counters = await api.getCounters();
            
            // For admin users, allow access to all counters
            if (this.currentUser.role_name === 'admin') {
                if (this.counters.length > 0) {
                    this.selectedCounter = this.counters[0];
                    document.getElementById('counter-info').textContent = `${this.selectedCounter.name} (Admin - All Access)`;
                }
                return;
            }
            
            // For staff users, use their assigned counter
            const userCounterId = this.currentUser.counter_id;
            
            if (userCounterId) {
                this.selectedCounter = this.counters.find(c => c.counter_id === userCounterId);
                
                if (this.selectedCounter) {
                    document.getElementById('counter-info').textContent = 
                        `${this.selectedCounter.name} - ${this.selectedCounter.service_name}`;
                } else {
                    utils.showError('Your assigned counter is not available. Please contact administrator.');
                    document.getElementById('counter-info').textContent = 'Counter Not Found';
                }
            } else {
                utils.showError('You are not assigned to any counter. Please contact administrator.');
                document.getElementById('counter-info').textContent = 'No Counter Assigned';
            }
        } catch (error) {
            console.error('Failed to load counters:', error);
        }
    }

    async loadQueue() {
        try {
            // Save current ticket ID to restore after reload
            const currentTicketId = this.currentTicket ? this.currentTicket.ticket_id : null;
            
            // Load all services
            const services = await api.getServices();
            this._services = services; // cache for avg time lookup
            let allTickets = [];
            
            // For admin users, load all tickets
            if (this.currentUser.role_name === 'admin') {
                for (const service of services) {
                    try {
                        const response = await api.request(`/api/tickets/all/${service.service_id}`);
                        const ticketsWithService = response.map(ticket => ({
                            ...ticket,
                            service_name: service.name
                        }));
                        allTickets = allTickets.concat(ticketsWithService);
                    } catch (error) {
                        console.error(`Failed to load queue for service ${service.service_id}:`, error);
                    }
                }
            } else {
                // For staff users, only load tickets for their counter's service
                if (!this.selectedCounter || !this.selectedCounter.service_id) {
                    this.queue = [];
                    this.renderQueue();
                    this.updateQueueStats();
                    return;
                }
                
                const service = services.find(s => s.service_id === this.selectedCounter.service_id);
                if (service) {
                    try {
                        const response = await api.request(`/api/tickets/all/${service.service_id}`);
                        allTickets = response.map(ticket => ({
                            ...ticket,
                            service_name: service.name
                        }));
                    } catch (error) {
                        console.error(`Failed to load queue for service ${service.service_id}:`, error);
                    }
                }
            }
            
            // Second-chance waiting tickets should be next, then regular oldest-first order.
            this.queue = allTickets.sort((a, b) => {
                const aPriority = a.status === 'waiting' && a.missed_calls > 0 ? 0 : 1;
                const bPriority = b.status === 'waiting' && b.missed_calls > 0 ? 0 : 1;
                if (aPriority !== bPriority) return aPriority - bPriority;
                return new Date(a.created_at) - new Date(b.created_at);
            });
            
            // Restore current ticket from reloaded queue
            if (currentTicketId) {
                const updatedTicket = this.queue.find(t => t.ticket_id === currentTicketId);
                if (updatedTicket) {
                    this.currentTicket = updatedTicket;
                }
            }

            if (!this.currentTicket || !['called', 'serving'].includes(this.currentTicket.status)) {
                this.currentTicket = this.findActiveCounterTicket();
            }
            
            this.renderQueue();
            this.renderCurrentTicket();
            this.updateQueueStats();
        } catch (error) {
            console.error('Failed to load queue:', error);
        }
    }

    findActiveCounterTicket() {
        if (!this.selectedCounter || !this.selectedCounter.counter_id) {
            return null;
        }

        const counterId = this.selectedCounter.counter_id;
        const activeTicket = this.queue.find(ticket =>
            ticket.counter_id === counterId &&
            (ticket.status === 'serving' || ticket.status === 'called')
        );

        return activeTicket || null;
    }

    renderQueue() {
        const queueList = document.getElementById('queue-list');
        
        // If on break, don't show any tickets
        if (this.isOnBreak()) {
            queueList.innerHTML = `
                <div class="no-queue" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <p>You are on break. Resume work to see tickets.</p>
                </div>
            `;
            return;
        }
        
        // Only show active tickets (waiting, called, serving)
        const activeTickets = this.queue.filter(t => 
            t.status === 'waiting' || t.status === 'called' || t.status === 'serving'
        );

        if (activeTickets.length === 0) {
            queueList.innerHTML = `
                <div class="no-queue" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <p>No tickets in queue</p>
                </div>
            `;
            return;
        }

        queueList.innerHTML = activeTickets.map(ticket => `
            <div class="queue-item" data-ticket-id="${ticket.ticket_id}">
                <div class="queue-item-info">
                    <div class="queue-item-number">${utils.formatTicketNumber(ticket.ticket_number)}</div>
                    <div class="queue-item-service">${ticket.service_name || 'Unknown Service'}</div>
                    ${ticket.missed_calls > 0 ? '<div class="queue-item-time" style="color: var(--warning-color); font-weight: 700;">Second chance ticket</div>' : ''}
                    <div class="queue-item-time">
                        Created: ${utils.formatTime(ticket.created_at)} 
                        (${utils.calculateWaitTime(ticket.created_at)} ago)
                    </div>
                </div>
                <div class="queue-item-actions">
                    ${ticket.status === 'waiting' ? `
                        <button class="btn btn-sm btn-primary" data-action="call" data-ticket-id="${ticket.ticket_id}">
                            Call
                        </button>
                    ` : ''}
                    ${ticket.status === 'called' ? `
                        <button class="btn btn-sm btn-primary" data-action="recall" data-ticket-id="${ticket.ticket_id}">
                            Recall
                        </button>
                        <button class="btn btn-sm btn-success" data-action="serve" data-ticket-id="${ticket.ticket_id}">
                            Serve
                        </button>
                        <button class="btn btn-sm btn-warning" data-action="noshow" data-ticket-id="${ticket.ticket_id}">
                            No Show
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
        
        // Attach event listeners to buttons
        queueList.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const ticketId = parseInt(e.target.dataset.ticketId);
                
                console.log('Queue button clicked:', action, 'Ticket ID:', ticketId);
                
                if (action === 'call') this.callTicket(ticketId);
                else if (action === 'recall') this.recallTicket(ticketId);
                else if (action === 'serve') this.serveTicket(ticketId);
                else if (action === 'noshow') this.markNoShow(ticketId);
            });
        });
    }

    updateQueueStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayTickets = this.queue.filter(t => {
            let ticketDate;
            if (typeof t.created_at === 'string' && !t.created_at.endsWith('Z') && t.created_at.includes(' ')) {
                ticketDate = new Date(t.created_at + ' UTC');
            } else {
                ticketDate = new Date(t.created_at);
            }
            return ticketDate >= today;
        });
        
        const waitingCount = todayTickets.filter(t => t.status === 'waiting').length;
        const calledCount = todayTickets.filter(t => t.status === 'called').length;
        const servingCount = todayTickets.filter(t => t.status === 'serving').length;
        const completedCount = todayTickets.filter(t => t.status === 'completed').length;
        
        document.getElementById('waiting-count').textContent = waitingCount;
        document.getElementById('served-today').textContent = completedCount;
        
        // Avg wait = service's calculated avg_time (same source as kiosk)
        // Use the counter's service avg_time if available
        const serviceAvgTime = this.selectedCounter && this.selectedCounter.service_id
            ? this._getServiceAvgTime(this.selectedCounter.service_id)
            : 0;
        document.getElementById('avg-wait-time').textContent = serviceAvgTime || '—';
    }

    _getServiceAvgTime(serviceId) {
        // Pull avg_time from the loaded services list
        if (!this._services) return 0;
        const svc = this._services.find(s => s.service_id === serviceId);
        return svc ? (svc.avg_time || svc.default_avg_time || 0) : 0;
    }

    async callNextTicket(options = {}) {
        const { showEmptyError = true } = options;

        if (this.isOnBreak()) {
            utils.showError('You are on break. Resume work to call tickets.');
            return false;
        }
        
        // Queue is oldest-first, so find() returns the oldest ticket waiting to be called.
        const nextTicket = this.queue.find(t => t.status === 'waiting');
        
        if (!nextTicket) {
            if (showEmptyError) {
                utils.showError('No tickets waiting in queue.');
            }
            return false;
        }

        await this.callTicket(nextTicket.ticket_id);
        return true;
    }

    async callTicket(ticketId) {
        try {
            // Find the ticket in queue FIRST
            const ticket = this.queue.find(t => t.ticket_id === ticketId);
            if (!ticket) {
                utils.showError('Ticket not found.');
                return;
            }
            
            // Update status in database
            const counterId = this.selectedCounter ? this.selectedCounter.counter_id : null;
            await api.updateTicketStatus(ticketId, 'called', counterId);
            
            // Update local ticket status
            ticket.status = 'called';
            if (counterId) {
                ticket.counter_id = counterId;
            }
            
            // Set as current ticket BEFORE reloading
            this.currentTicket = ticket;
            
            // Render current ticket
            this.renderCurrentTicket();
            
            utils.showSuccess(`Ticket ${utils.formatTicketNumber(ticket.ticket_number)} has been called.`);
            
            // Reload queue to get updated data
            await this.loadQueue();
        } catch (error) {
            console.error('Failed to call ticket:', error);
            utils.showError('Failed to call ticket.');
        }
    }

    async serveTicket(ticketId) {
        try {
            // Get counter ID for this staff member
            const counterId = this.selectedCounter ? this.selectedCounter.counter_id : null;
            
            if (!counterId) {
                utils.showError('No counter assigned. Cannot serve ticket.');
                return;
            }
            
            // Find the ticket in queue FIRST
            const ticket = this.queue.find(t => t.ticket_id === ticketId);
            if (!ticket) {
                utils.showError('Ticket not found.');
                return;
            }
            
            // Update status in database
            await api.updateTicketStatus(ticketId, 'serving', counterId);
            
            // Update local ticket status
            ticket.status = 'serving';
            ticket.counter_id = counterId;
            
            // Set as current ticket BEFORE reloading
            this.currentTicket = ticket;
            
            // Render current ticket
            this.renderCurrentTicket();
            
            utils.showSuccess(`Now serving ticket ${utils.formatTicketNumber(ticket.ticket_number)}.`);
            
            // Reload queue to get updated data
            await this.loadQueue();
        } catch (error) {
            console.error('Failed to serve ticket:', error);
            utils.showError('Failed to serve ticket.');
        }
    }

    async recallTicket(ticketId) {
        try {
            const counterId = this.selectedCounter ? this.selectedCounter.counter_id : null;
            const ticket = this.queue.find(t => t.ticket_id === ticketId);
            await api.updateTicketStatus(ticketId, 'called', counterId);
            if (ticket) {
                this.currentTicket = { ...ticket, status: 'called', counter_id: counterId };
                this.renderCurrentTicket();
                utils.showSuccess(`Ticket ${utils.formatTicketNumber(ticket.ticket_number)} recalled.`);
            }
            await this.loadQueue();
        } catch (error) {
            console.error('Failed to recall ticket:', error);
            utils.showError('Failed to recall ticket.');
        }
    }

    async completeTicket(ticketId) {
        try {
            const counterId = this.selectedCounter ? this.selectedCounter.counter_id : null;
            await api.updateTicketStatus(ticketId, 'completed', counterId, {
                autoCallNext: this.autoCallEnabled
            });
            
            this.currentTicket = null;
            this.renderCurrentTicket();
            utils.showSuccess('Ticket completed successfully.');
            
            await this.loadQueue();
        } catch (error) {
            console.error('Failed to complete ticket:', error);
            utils.showError('Failed to complete ticket.');
        }
    }

    async markNoShow(ticketId) {
        try {
            await api.updateTicketStatus(ticketId, 'no-show');
            
            // If this was the current ticket, clear it
            if (this.currentTicket && this.currentTicket.ticket_id === ticketId) {
                this.currentTicket = null;
                this.renderCurrentTicket();
            }
            
            const ticket = this.queue.find(t => t.ticket_id === ticketId);
            if (ticket) {
                utils.showSuccess(`Ticket ${utils.formatTicketNumber(ticket.ticket_number)} marked as no-show.`);
            }
            
            await this.loadQueue();
        } catch (error) {
            console.error('Failed to mark no-show:', error);
            utils.showError('Failed to mark ticket as no-show.');
        }
    }

    renderCurrentTicket() {
        const currentTicketContent = document.getElementById('current-ticket-content');
        
        if (!this.currentTicket) {
            currentTicketContent.innerHTML = `
                <div class="no-ticket">
                    <div class="no-ticket-icon">📋</div>
                    <p>No active ticket</p>
                    <button id="call-next-btn" class="btn btn-primary btn-lg">
                        Call Next Customer
                    </button>
                </div>
            `;
            
            // Re-attach event listener
            document.getElementById('call-next-btn').addEventListener('click', () => {
                this.callNextTicket();
            });
            return;
        }

        currentTicketContent.innerHTML = `
            <div class="ticket-card">
                <div class="ticket-header">
                    <div class="ticket-number-display">${utils.formatTicketNumber(this.currentTicket.ticket_number)}</div>
                    <div class="ticket-time">${utils.formatTime(this.currentTicket.created_at)}</div>
                </div>
                <div class="ticket-service">${this.currentTicket.service_name || 'Unknown Service'}</div>
                <div class="ticket-wait-time">
                    Wait time: ${utils.calculateWaitTime(this.currentTicket.created_at)}
                </div>
                <div class="ticket-actions">
                    ${this.currentTicket.status === 'called' ? `
                        <button class="btn btn-primary" data-action="recall" data-ticket-id="${this.currentTicket.ticket_id}">
                            Recall
                        </button>
                        <button class="btn btn-success" data-action="serve" data-ticket-id="${this.currentTicket.ticket_id}">
                            Start Serving
                        </button>
                        <button class="btn btn-warning" data-action="noshow" data-ticket-id="${this.currentTicket.ticket_id}">
                            No Show
                        </button>
                    ` : ''}
                    ${this.currentTicket.status === 'serving' ? `
                        <button class="btn btn-primary" data-action="complete" data-ticket-id="${this.currentTicket.ticket_id}">
                            Complete Service
                        </button>
                        <button class="btn btn-secondary" data-action="callnext">
                            Call Next
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Attach event listeners to current ticket buttons
        const ticketCard = currentTicketContent.querySelector('.ticket-card');
        if (ticketCard) {
            ticketCard.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const action = e.target.dataset.action;
                    const ticketId = parseInt(e.target.dataset.ticketId);
                    
                    console.log('Button clicked:', action, 'Ticket ID:', ticketId);
                    
                    if (action === 'serve') this.serveTicket(ticketId);
                    else if (action === 'recall') this.recallTicket(ticketId);
                    else if (action === 'noshow') this.markNoShow(ticketId);
                    else if (action === 'complete') this.completeTicket(ticketId);
                    else if (action === 'callnext') this.callNextTicket();
                });
            });
        }
    }

    async updateMetrics() {
        // Filter tickets created today (in local timezone)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayTickets = this.queue.filter(t => {
            let ticketDate;
            if (typeof t.created_at === 'string' && !t.created_at.endsWith('Z') && t.created_at.includes(' ')) {
                // SQLite format: treat as UTC
                ticketDate = new Date(t.created_at + ' UTC');
            } else {
                ticketDate = new Date(t.created_at);
            }
            return ticketDate >= today;
        });
        
        const completedToday = todayTickets.filter(t => t.status === 'completed').length;
        const noShowToday = todayTickets.filter(t => t.status === 'no-show').length;
        
        document.getElementById('tickets-served').textContent = completedToday;
        document.getElementById('no-show-count').textContent = noShowToday;
        
        // Calculate average service time from completed tickets today
        const completedTickets = todayTickets.filter(t => t.status === 'completed' && t.completed_at);
        let avgTime = 0;
        let totalWaitTime = 0;
        
        if (completedTickets.length > 0) {
            const totalTime = completedTickets.reduce((sum, ticket) => {
                const completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                    ? new Date(ticket.completed_at + ' UTC')
                    : new Date(ticket.completed_at);
                const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                    ? new Date(ticket.created_at + ' UTC')
                    : new Date(ticket.created_at);
                const serviceTime = (completedDate - createdDate) / (1000 * 60);
                return sum + serviceTime;
            }, 0);
            avgTime = Math.round(totalTime / completedTickets.length);
            totalWaitTime = Math.round(totalTime);
            
            document.getElementById('avg-service-time').textContent = avgTime;
            document.getElementById('total-wait-time').textContent = totalWaitTime;
        } else {
            document.getElementById('avg-service-time').textContent = '0';
            document.getElementById('total-wait-time').textContent = '0';
        }
        
        // Clear the change indicators (no historical data to compare)
        const changeElements = [
            'tickets-served-change',
            'avg-service-time-change', 
            'no-show-change',
            'total-wait-time-change'
        ];
        
        changeElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.textContent = '';
        });
    }

    setupEventListeners() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            this.login(username, password);
        });

        // Logout button
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadQueue();
        });

        // Quick actions
        document.getElementById('view-history').addEventListener('click', (e) => {
            e.preventDefault();
            this.showHistory();
        });

        document.getElementById('break-mode').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleBreakMode();
        });

        document.getElementById('auto-call-mode').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleAutoCallMode();
        });

        this.updateAutoCallToggle();
    }

    toggleAutoCallMode() {
        this.autoCallEnabled = !this.autoCallEnabled;
        utils.storage.set('staff_auto_call_enabled', this.autoCallEnabled);
        this.updateAutoCallToggle();

        if (this.autoCallEnabled) {
            utils.showSuccess('Automatic next-ticket calling is on.');
        } else {
            utils.showSuccess('Automatic next-ticket calling is paused. Use Call manually for priority tickets.');
        }
    }

    updateAutoCallToggle() {
        const autoCallBtn = document.getElementById('auto-call-mode');
        if (!autoCallBtn) return;

        const autoCallIcon = autoCallBtn.querySelector('.quick-action-icon');
        const autoCallLabel = autoCallBtn.querySelector('span');

        autoCallBtn.classList.toggle('quick-action-paused', !this.autoCallEnabled);
        autoCallBtn.setAttribute('aria-pressed', String(this.autoCallEnabled));
        autoCallIcon.textContent = this.autoCallEnabled ? 'Auto' : 'Manual';
        autoCallLabel.textContent = this.autoCallEnabled ? 'Auto Call On' : 'Auto Call Paused';
        autoCallBtn.title = this.autoCallEnabled
            ? 'Automatically call the next waiting ticket after completing service'
            : 'Automation is paused so staff can call priority tickets manually';
    }

    showHistory() {
        // Remove any existing history modal
        const existing = document.getElementById('history-modal');
        if (existing) existing.remove();

        const completedTickets = this.queue.filter(t => ['completed', 'no-show', 'cancelled'].includes(t.status));
        
        const historyHTML = completedTickets.length === 0
            ? '<p style="text-align:center; color:var(--text-secondary); padding:1rem;">No history available yet.</p>'
            : completedTickets.slice(0, 10).map(ticket => `
                <div style="padding: 0.75rem; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong>${utils.formatTicketNumber(ticket.ticket_number)}</strong>
                        ${utils.getStatusBadge(ticket.status)}
                    </div>
                    <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 0.25rem;">
                        ${ticket.service_name} — ${utils.formatTime(ticket.created_at)}
                    </div>
                </div>
            `).join('');

        const modal = document.createElement('div');
        modal.id = 'history-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.5);
            display: flex; align-items: center; justify-content: center; z-index: 9999;
        `;
        modal.innerHTML = `
            <div style="background: white; border-radius: 0.75rem; width: 90%; max-width: 480px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid var(--border-color);">
                    <h3 style="margin: 0;">Recent History (Last 10)</h3>
                    <button onclick="document.getElementById('history-modal').remove()" style="background:none; border:none; font-size:1.5rem; cursor:pointer; line-height:1;">&times;</button>
                </div>
                <div style="max-height: 400px; overflow-y: auto;">
                    ${historyHTML}
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    toggleBreakMode() {
        const statusIndicator = document.querySelector('.status-indicator');
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-indicator span');
        const breakBtn = document.getElementById('break-mode');
        const breakIcon = breakBtn.querySelector('.quick-action-icon');
        const breakLabel = breakBtn.querySelector('span');
        
        if (statusDot.classList.contains('online')) {
            // Go on break
            statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.textContent = 'On Break';
            breakIcon.textContent = '▶️';
            breakLabel.textContent = 'Resume Work';
            
            // Clear current ticket if any
            this.currentTicket = null;
            this.renderCurrentTicket();
            
            utils.showSuccess('You are now on break. No tickets will be shown.');
        } else {
            // Go back online
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.textContent = 'Online';
            breakIcon.textContent = '⏸️';
            breakLabel.textContent = 'Take Break';
            
            utils.showSuccess('You are back online and ready to serve customers.');
            
            // Reload queue
            this.loadQueue();
        }
    }

    isOnBreak() {
        const statusDot = document.querySelector('.status-dot');
        return statusDot && !statusDot.classList.contains('online');
    }

    setupWebSocketHandlers() {
        api.onWebSocketMessage((data) => {
            if (data.type === 'queue_update' || data.type === 'ticket_update') {
                this.loadQueue();
            }
        });
    }

    startPeriodicUpdates() {
        // Refresh queue every 30 seconds
        setInterval(() => {
            this.loadQueue();
        }, 30000);

        // Update metrics every 5 minutes
        setInterval(() => {
            this.updateMetrics();
        }, 300000);
    }
}

// Global instance
let staffDashboard;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    staffDashboard = new StaffDashboard();
});
