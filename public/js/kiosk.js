// Kiosk interface JavaScript

class KioskInterface {
    constructor() {
        this.selectedService = null;
        this.services = [];
        this.counters = [];
        this.currentTicket = null;
        this.lastTicketStatus = null;
        this.audioContext = null;
        this.alertRingSeconds = 5;
        this.statusCheckInterval = null;
        this.init();
    }

    async init() {
        try {
            await this.loadServices();
            await this.loadCounters();
            await this.loadPublicSettings();
            this.setupEventListeners();
            this.setupWebSocketHandlers();
            await this.restoreTicketFromUrl();
        } catch (error) {
            console.error('Failed to initialize kiosk:', error);
            utils.showError('Failed to load services. Please try again.');
        }
    }

    async loadCounters() {
        try {
            this.counters = await api.request('/api/counters');
        } catch (error) {
            console.error('Failed to load counters:', error);
            this.counters = [];
        }
    }

    async loadPublicSettings() {
        try {
            const settings = await api.request('/api/public-settings');
            const alertSeconds = Number.parseInt(settings.alert_ring_seconds, 10);
            if (Number.isFinite(alertSeconds)) {
                this.alertRingSeconds = Math.min(Math.max(alertSeconds, 1), 15);
            }
        } catch (error) {
            console.error('Failed to load public settings:', error);
        }
    }

    async loadServices() {
        try {
            utils.showLoading('Loading services...');
            this.services = await api.getServices();
            this.renderServices();
        } catch (error) {
            console.error('Failed to load services:', error);
            utils.showError('Failed to load services. Please refresh the page.');
        } finally {
            utils.hideLoading();
        }
    }

    renderServices() {
        const serviceGrid = document.getElementById('service-grid');
        
        if (!this.services || this.services.length === 0) {
            serviceGrid.innerHTML = `
                <div class="service-card">
                    <h3>No Services Available</h3>
                    <p>Please contact staff for assistance</p>
                </div>
            `;
            return;
        }

        serviceGrid.innerHTML = this.services.map(service => {
            // Find counters for this service
            const serviceCounters = this.counters.filter(c => c.service_id === service.service_id && c.is_active);
            const counterNames = serviceCounters.map(c => c.name).join(', ');
            
            return `
                <div class="service-card" data-service-id="${service.service_id}">
                    <h3>${service.name}</h3>
                    <p>Professional service with quality assurance</p>
                    ${counterNames ? `
                        <div class="counter-info" style="margin: 0.5rem 0; padding: 0.5rem; background: var(--bg-secondary); border-radius: 4px; font-size: 0.875rem;">
                            📍 Served at: ${counterNames}
                        </div>
                    ` : ''}
                    <div class="avg-time">
                        Average wait: ${service.avg_time ? service.avg_time + ' min' : 'Varies'} per customer
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers to service cards
        document.querySelectorAll('.service-card').forEach(card => {
            card.addEventListener('click', () => {
                const serviceId = parseInt(card.dataset.serviceId);
                this.selectService(serviceId);
            });
        });
    }

    selectService(serviceId) {
        // Remove previous selection
        document.querySelectorAll('.service-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Add selection to clicked card
        const selectedCard = document.querySelector(`[data-service-id="${serviceId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            this.selectedService = this.services.find(s => s.service_id === serviceId);
            
            // Enable get ticket button
            const getTicketBtn = document.getElementById('get-ticket-btn');
            getTicketBtn.disabled = false;
        }
    }

    async generateTicket() {
        if (!this.selectedService) {
            utils.showError('Please select a service first.');
            return;
        }

        try {
            this.prepareAlertSound();
            utils.showLoading('Generating your ticket...');
            
            const ticketData = await api.createTicket(this.selectedService.service_id);
            
            // Store current ticket
            this.currentTicket = {
                ticketId: ticketData.ticketId,
                ticketNumber: ticketData.ticketNumber,
                serviceId: this.selectedService.service_id,
                serviceName: this.selectedService.name
            };
            this.lastTicketStatus = ticketData.status || 'waiting';
            
            this.displayTicket(ticketData);
            this.updateTicketStatus({
                ticket_id: ticketData.ticketId,
                ticket_number: ticketData.ticketNumber,
                service_id: this.selectedService.service_id,
                status: ticketData.status || 'waiting',
                counter_id: ticketData.counterId || null,
                counter_name: ticketData.counterName || null,
                missed_calls: 0
            });
            this.updateTicketLink(ticketData.ticketId);
            
            // Start monitoring ticket status
            this.startStatusMonitoring();
            
            utils.showSuccess('Ticket generated successfully!');
            
        } catch (error) {
            console.error('Failed to generate ticket:', error);
            utils.showError('Failed to generate ticket. Please try again.');
        } finally {
            utils.hideLoading();
        }
    }

    async startStatusMonitoring() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        // Check ticket status every 5 seconds using the single ticket endpoint
        this.statusCheckInterval = setInterval(async () => {
            if (!this.currentTicket) {
                clearInterval(this.statusCheckInterval);
                return;
            }
            
            try {
                // Use queue endpoint — returns active tickets (waiting/called/serving)
                const response = await api.request(`/api/queue/${this.currentTicket.serviceId}`);
                const ticket = response.find(t => t.ticket_id === this.currentTicket.ticketId);
                
                if (ticket) {
                    this.updateTicketStatus(ticket);
                } else {
                    // Ticket not in active queue - check if it reached a final status.
                    // by fetching all tickets for the service
                    const allResponse = await api.request(`/api/tickets/all/${this.currentTicket.serviceId}`);
                    const fullTicket = allResponse.find(t => t.ticket_id === this.currentTicket.ticketId);
                    if (fullTicket && ['completed', 'no-show', 'cancelled'].includes(fullTicket.status)) {
                        this.updateTicketStatus(fullTicket);
                    }
                }
            } catch (error) {
                console.error('Failed to check ticket status:', error);
            }
        }, 5000);
    }

    updateTicketStatus(ticket) {
        const statusElement = document.getElementById('ticket-status');
        const statusMessageElement = document.getElementById('status-message');
        
        if (!statusElement || !statusMessageElement) return;
        const previousStatus = this.lastTicketStatus;
        
        // Update position in queue
        this.updateQueuePosition();
        
        switch (ticket.status) {
            case 'waiting':
                statusElement.textContent = 'Waiting to be called';
                statusElement.className = 'ticket-status waiting';
                statusMessageElement.textContent = ticket.missed_calls > 0
                    ? 'You were called but failed to show up. We will give you one more chance next. If you miss again, your ticket will be cancelled.'
                    : 'Please wait for your turn. You will be called soon.';
                break;
            case 'called':
                statusElement.textContent = 'Called, awaiting service';
                statusElement.className = 'ticket-status called';
                statusMessageElement.textContent = '🔔 Your ticket has been called! Please proceed to the counter.';
                break;
            case 'serving':
                statusElement.textContent = 'Being Served';
                statusElement.className = 'ticket-status serving';
                statusMessageElement.textContent = '👤 You are currently being served.';
                break;
            case 'completed':
                statusElement.textContent = 'Completed';
                statusElement.className = 'ticket-status completed';
                statusMessageElement.textContent = '✅ Service completed. Thank you!';
                // Stop monitoring and reset after 10 seconds
                clearInterval(this.statusCheckInterval);
                setTimeout(() => this.resetInterface(), 10000);
                break;
            case 'no-show':
                statusElement.textContent = 'No Show';
                statusElement.className = 'ticket-status no-show';
                statusMessageElement.textContent = '❌ You missed your turn. Please get a new ticket.';
                clearInterval(this.statusCheckInterval);
                setTimeout(() => this.resetInterface(), 10000);
                break;
            case 'cancelled':
                statusElement.textContent = 'Cancelled';
                statusElement.className = 'ticket-status cancelled';
                statusMessageElement.textContent = 'Your ticket has been cancelled.';
                clearInterval(this.statusCheckInterval);
                setTimeout(() => this.resetInterface(), 10000);
                break;
        }

        if (ticket.status === 'no-show') {
            statusMessageElement.textContent = 'You were called twice but failed to show up. Your ticket has been cancelled.';
        }

        if (previousStatus && previousStatus !== ticket.status) {
            this.playStatusAlert(ticket.status);
        }
        this.lastTicketStatus = ticket.status;
    }

    applyTransferredTicket(ticket) {
        if (!this.currentTicket || ticket.ticket_id !== this.currentTicket.ticketId) {
            return;
        }

        const service = this.services.find(item => item.service_id === ticket.service_id) || {
            service_id: ticket.service_id,
            name: ticket.service_name || 'Selected Service',
            avg_time: 5
        };

        this.selectedService = service;
        this.currentTicket.serviceId = ticket.service_id;
        this.currentTicket.serviceName = service.name;

        const serviceElement = document.getElementById('ticket-service');
        if (serviceElement) {
            serviceElement.textContent = service.name;
        }

        const counterElement = document.getElementById('ticket-counter');
        if (counterElement) {
            if (ticket.counter_name) {
                counterElement.textContent = ticket.counter_name;
            } else if (ticket.counter_id) {
                const counter = this.counters.find(c => c.counter_id === ticket.counter_id);
                counterElement.textContent = counter ? counter.name : 'Proceed to assigned counter';
            } else {
                const serviceCounters = this.counters.filter(c => c.service_id === ticket.service_id && c.is_active);
                const counterNames = serviceCounters.map(c => c.name).join(', ');
                counterElement.textContent = counterNames || 'See staff for assistance';
            }
        }

        this.updateTicketStatus(ticket);
        this.updateQueuePosition();
        this.playStatusAlert('waiting');
        utils.showSuccess(`Your ticket was transferred to ${service.name}.`);
    }

    prepareAlertSound() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            if (!this.audioContext) {
                this.audioContext = new AudioContext();
            }

            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        } catch (error) {
            console.error('Failed to prepare alert sound:', error);
        }
    }

    playStatusAlert(status) {
        if (!['called', 'serving', 'completed', 'no-show', 'cancelled', 'waiting'].includes(status)) return;

        try {
            this.prepareAlertSound();
            if (!this.audioContext) return;

            const now = this.audioContext.currentTime;
            const pattern = [];
            for (let offset = 0; offset < this.alertRingSeconds; offset += 0.5) {
                pattern.push(offset);
            }

            pattern.forEach((offset) => {
                this.playTone(now + offset, ['no-show', 'cancelled'].includes(status) ? 440 : 880, 0.25);
            });
        } catch (error) {
            console.error('Failed to play status alert:', error);
        }
    }

    playTone(startTime, frequency, duration) {
        const oscillator = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.35, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        oscillator.connect(gain);
        gain.connect(this.audioContext.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + duration + 0.03);
    }

    async updateQueuePosition() {
        if (!this.currentTicket) return;
        
        try {
            const response = await api.request(`/api/queue/${this.currentTicket.serviceId}`);
            const waitingTickets = response.filter(t => t.status === 'waiting' || t.status === 'called');
            
            // Find position of current ticket
            const ticketIndex = waitingTickets.findIndex(t => t.ticket_id === this.currentTicket.ticketId);
            const position = ticketIndex >= 0 ? ticketIndex + 1 : 0;
            
            const positionElement = document.getElementById('ticket-position');
            if (positionElement) {
                positionElement.textContent = position > 0 ? position : 'Being Served';
            }
            
            // Calculate estimated wait time using the service's calculated avg_time
            const serviceCounters = this.counters.filter(c => c.service_id === this.currentTicket.serviceId && c.is_active);
            const avgTime = this.selectedService ? (this.selectedService.avg_time || this.selectedService.default_avg_time || 5) : 5;
            const customersAhead = Math.max(position - 1, 0);
            const estimatedWait = position > 0 ? Math.ceil(customersAhead * avgTime / Math.max(serviceCounters.length, 1)) : 0;
            
            const waitElement = document.getElementById('estimated-wait');
            if (waitElement) {
                waitElement.textContent = estimatedWait > 0 ? utils.formatDuration(estimatedWait) : '0 min';
            }
        } catch (error) {
            console.error('Failed to update queue position:', error);
        }
    }

    displayTicket(ticketData) {
        // Hide service selection
        document.getElementById('service-selection').classList.add('hidden');
        
        // Show ticket display
        const ticketDisplay = document.getElementById('ticket-display');
        ticketDisplay.classList.remove('hidden');

        // Update ticket information
        document.getElementById('ticket-number').textContent = utils.formatTicketNumber(ticketData.ticketNumber);
        document.getElementById('ticket-service').textContent = this.selectedService.name;
        this.updateTicketLink(this.currentTicket.ticketId);
        
        // Show which counter(s) handle this service
        const counterElement = document.getElementById('ticket-counter');
        if (ticketData.counterName) {
            counterElement.textContent = ticketData.counterName;
        } else {
            const serviceCounters = this.counters.filter(c => c.service_id === this.selectedService.service_id && c.is_active);
            const counterNames = serviceCounters.map(c => c.name).join(', ');
            counterElement.textContent = counterNames || 'See staff for assistance';
        }
        
        // Initial position and wait time
        this.updateQueuePosition();
    }

    async cancelTicket() {
        if (!this.currentTicket) return;
        
        if (!confirm('Are you sure you want to cancel this ticket?')) {
            return;
        }
        
        try {
            utils.showLoading('Cancelling ticket...');
            
            await api.request(`/api/tickets/${this.currentTicket.ticketId}/cancel`, {
                method: 'PUT'
            });
            
            utils.showSuccess('Ticket cancelled successfully.');
            this.resetInterface();
            
        } catch (error) {
            console.error('Failed to cancel ticket:', error);
            utils.showError('Failed to cancel ticket.');
        } finally {
            utils.hideLoading();
        }
    }

    resetInterface() {
        // Stop status monitoring
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
        
        // Clear current ticket
        this.currentTicket = null;
        this.lastTicketStatus = null;
        
        // Hide ticket display
        document.getElementById('ticket-display').classList.add('hidden');
        
        // Show service selection
        document.getElementById('service-selection').classList.remove('hidden');
        
        // Reset selection
        this.selectedService = null;
        document.querySelectorAll('.service-card').forEach(card => {
            card.classList.remove('selected');
        });
        
        // Disable get ticket button
        document.getElementById('get-ticket-btn').disabled = true;

        if (window.location.search.includes('ticketId=')) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    buildTicketLink(ticketId) {
        const url = new URL(window.location.href);
        url.pathname = '/';
        url.search = '';
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            url.hostname = '192.168.0.103';
        }
        url.searchParams.set('ticketId', ticketId);
        return url.toString();
    }

    updateTicketLink(ticketId) {
        const input = document.getElementById('ticket-share-link');
        if (input && ticketId) {
            const link = this.buildTicketLink(ticketId);
            input.value = link;
            const qr = document.getElementById('ticket-qr-code');
            if (qr) {
                qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(link)}`;
            }
        }
    }

    async copyTicketLink() {
        if (!this.currentTicket) return;
        const link = this.buildTicketLink(this.currentTicket.ticketId);
        try {
            await navigator.clipboard.writeText(link);
            utils.showSuccess('Ticket link copied.');
        } catch (error) {
            const input = document.getElementById('ticket-share-link');
            if (input) {
                input.select();
                document.execCommand('copy');
                utils.showSuccess('Ticket link copied.');
            }
        }
    }

    async restoreTicketFromUrl() {
        const ticketId = Number.parseInt(new URLSearchParams(window.location.search).get('ticketId'), 10);
        if (!Number.isInteger(ticketId)) return;

        try {
            const ticket = await api.request(`/api/tickets/${ticketId}`);
            const service = this.services.find(item => item.service_id === ticket.service_id) || {
                service_id: ticket.service_id,
                name: ticket.service_name || 'Selected Service',
                avg_time: 5
            };

            this.selectedService = service;
            this.currentTicket = {
                ticketId: ticket.ticket_id,
                ticketNumber: ticket.ticket_number,
                serviceId: ticket.service_id,
                serviceName: service.name
            };
            this.lastTicketStatus = ticket.status;
            this.displayTicket({ ticketId: ticket.ticket_id, ticketNumber: ticket.ticket_number });
            this.updateTicketStatus(ticket);
            this.startStatusMonitoring();
        } catch (error) {
            console.error('Failed to restore ticket:', error);
            utils.showError('This ticket link could not be loaded.');
        }
    }

    setupEventListeners() {
        // Get ticket button
        document.getElementById('get-ticket-btn').addEventListener('click', () => {
            this.generateTicket();
        });

        // Cancel ticket button
        document.getElementById('cancel-ticket-btn').addEventListener('click', () => {
            this.cancelTicket();
        });

        document.getElementById('print-ticket-btn').addEventListener('click', () => {
            window.print();
        });

        document.getElementById('copy-ticket-link-btn').addEventListener('click', () => {
            this.copyTicketLink();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (!document.getElementById('service-selection').classList.contains('hidden')) {
                    const getTicketBtn = document.getElementById('get-ticket-btn');
                    if (!getTicketBtn.disabled) {
                        this.generateTicket();
                    }
                }
            } else if (event.key === 'Escape') {
                if (!document.getElementById('ticket-display').classList.contains('hidden')) {
                    this.cancelTicket();
                }
            }
        });
    }

    setupWebSocketHandlers() {
        api.onWebSocketMessage((data) => {
            if (data.type === 'queue_update') {
                // Update queue information if needed
                this.updateQueueInfo(data);
            } else if (data.type === 'ticket_update' && this.currentTicket && data.ticketId === this.currentTicket.ticketId) {
                if (data.transferred && data.ticket) {
                    this.applyTransferredTicket(data.ticket);
                } else {
                    api.request(`/api/tickets/${this.currentTicket.ticketId}`)
                        .then(ticket => this.updateTicketStatus(ticket))
                        .catch(error => console.error('Failed to refresh ticket update:', error));
                }
            }
        });
    }

    updateQueueInfo(data) {
        if (this.selectedService && data.serviceId === this.selectedService.service_id) {
            if (this.currentTicket && !document.getElementById('ticket-display').classList.contains('hidden')) {
                this.updateQueuePosition();
            }
        }
    }
}

// Initialize kiosk interface when page loads
document.addEventListener('DOMContentLoaded', () => {
    new KioskInterface();
});

// Prevent context menu and text selection for kiosk mode
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
