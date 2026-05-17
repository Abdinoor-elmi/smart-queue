// Counter-based queue display

class QueueDisplay {
    constructor() {
        this.ws = null;
        this.services = [];
        this.counters = [];
        this.tickets = [];
        this.audioContext = null;
        this.soundEnabled = false;
        this.lastCalledTicketIds = new Set();
        this.init();
        this.updateTime();
        setInterval(() => this.updateTime(), 1000);
        setInterval(() => this.loadQueueData(), 10000);
    }

    async init() {
        await this.loadServices();
        await this.loadCounters();
        this.setupSoundButton();
        this.connectWebSocket();
        await this.loadQueueData();
    }

    async loadServices() {
        try {
            const response = await fetch('/api/services');
            this.services = await response.json();
        } catch (error) {
            console.error('Failed to load services:', error);
            this.services = [];
        }
    }

    async loadCounters() {
        try {
            const response = await fetch('/api/counters');
            this.counters = await response.json();
        } catch (error) {
            console.error('Failed to load counters:', error);
            this.counters = [];
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.hideConnectionWarning();
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'queue_update' || data.type === 'ticket_update') {
                    this.loadQueueData();
                }
            };

            this.ws.onclose = () => {
                this.showConnectionWarning('Connection lost. Reconnecting...');
                setTimeout(() => this.connectWebSocket(), 3000);
            };

            this.ws.onerror = () => {
                this.showConnectionWarning('Network problem. Live display may be delayed.');
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.showConnectionWarning('Unable to connect to live updates.');
        }
    }

    async loadQueueData() {
        try {
            const allTickets = [];

            for (const service of this.services) {
                const response = await fetch(`/api/queue/${service.service_id}`);
                const tickets = await response.json();
                allTickets.push(...tickets.map(ticket => ({
                    ...ticket,
                    service_name: service.name
                })));
            }

            this.tickets = allTickets.sort((a, b) => this.parseDate(a.created_at) - this.parseDate(b.created_at));
            this.alertForNewCalledTickets();
            this.updateSummary();
            this.renderCounterBoard();

            document.getElementById('last-updated').textContent = new Date().toLocaleTimeString('en-KE', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch (error) {
            console.error('Failed to load queue data:', error);
            this.showConnectionWarning('Failed to load queue data.');
        }
    }

    setupSoundButton() {
        const button = document.getElementById('enable-sound-btn');
        if (!button) return;

        button.addEventListener('click', () => {
            this.prepareSound();
            this.soundEnabled = true;
            button.classList.add('enabled');
            this.playTonePattern();
        });
    }

    prepareSound() {
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
            console.error('Failed to prepare display sound:', error);
        }
    }

    alertForNewCalledTickets() {
        const calledIds = new Set(this.tickets
            .filter(ticket => ticket.status === 'called')
            .map(ticket => ticket.ticket_id));

        const hasNewCalledTicket = [...calledIds].some(ticketId => !this.lastCalledTicketIds.has(ticketId));
        this.lastCalledTicketIds = calledIds;

        if (hasNewCalledTicket) {
            this.playTonePattern();
        }
    }

    playTonePattern() {
        if (!this.soundEnabled) return;
        this.prepareSound();
        if (!this.audioContext) return;

        const now = this.audioContext.currentTime;
        for (let offset = 0; offset < 3; offset += 0.45) {
            const oscillator = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, now + offset);
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.25);
            oscillator.connect(gain);
            gain.connect(this.audioContext.destination);
            oscillator.start(now + offset);
            oscillator.stop(now + offset + 0.28);
        }
    }

    showConnectionWarning(message) {
        let banner = document.getElementById('connection-status-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'connection-status-banner';
            banner.className = 'connection-status-banner';
            document.body.appendChild(banner);
        }
        banner.textContent = message;
        banner.classList.add('show');
    }

    hideConnectionWarning() {
        const banner = document.getElementById('connection-status-banner');
        if (banner) banner.classList.remove('show');
    }

    renderCounterBoard() {
        const board = document.getElementById('counter-board');
        const activeCounters = this.counters.filter(counter => counter.is_active);

        if (activeCounters.length === 0) {
            board.innerHTML = '<div class="no-queue">No active counters configured</div>';
            return;
        }

        board.innerHTML = activeCounters.map(counter => {
            const tickets = this.getTicketsForCounter(counter);
            return `
                <section class="counter-column">
                    <div class="counter-header">
                        <div class="counter-name">${this.escapeHtml(counter.name)}</div>
                        <div class="counter-service">${this.escapeHtml(counter.service_name || 'No service assigned')}</div>
                    </div>
                    <div class="counter-tickets">
                        ${this.renderTickets(tickets)}
                    </div>
                </section>
            `;
        }).join('');
    }

    getTicketsForCounter(counter) {
        return this.tickets
            .filter(ticket => {
                const ticketCounterId = Number.parseInt(ticket.counter_id, 10);
                if (Number.isInteger(ticketCounterId)) {
                    return ticketCounterId === counter.counter_id;
                }
                return ticket.service_id === counter.service_id;
            })
            .sort((a, b) => this.parseDate(a.created_at) - this.parseDate(b.created_at));
    }

    renderTickets(tickets) {
        if (tickets.length === 0) {
            return '<div class="no-queue">No tickets for this counter</div>';
        }

        return tickets.map((ticket, index) => `
            <div class="ticket-row ${this.escapeHtml(ticket.status)}">
                <div class="ticket-left">
                    <span class="ticket-sequence">${index + 1}</span>
                    <div>
                        <div class="ticket-number">${this.escapeHtml(ticket.ticket_number)}</div>
                        <div class="ticket-time">${this.formatTime(ticket.created_at)}</div>
                    </div>
                </div>
                <span class="ticket-state ${this.escapeHtml(ticket.status)}">${this.formatStatus(ticket)}</span>
            </div>
        `).join('');
    }

    updateSummary() {
        const waiting = this.tickets.filter(ticket => ticket.status === 'waiting').length;
        const called = this.tickets.filter(ticket => ticket.status === 'called').length;
        const serving = this.tickets.filter(ticket => ticket.status === 'serving').length;

        document.getElementById('total-waiting').textContent = waiting;
        document.getElementById('total-called').textContent = called;
        document.getElementById('total-serving').textContent = serving;
    }

    formatStatus(ticket) {
        const labels = {
            waiting: 'Waiting to be called',
            called: 'Called',
            serving: 'Being served'
        };
        if (ticket.missed_calls > 0 && ticket.status === 'waiting') {
            return 'Second Chance';
        }
        return labels[ticket.status] || ticket.status;
    }

    formatTime(value) {
        const date = this.parseDate(value);
        if (!date || Number.isNaN(date.getTime())) return '';

        return date.toLocaleTimeString('en-KE', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Africa/Nairobi'
        });
    }

    parseDate(value) {
        if (typeof value === 'string' && !value.endsWith('Z') && value.includes(' ')) {
            return new Date(`${value} UTC`);
        }
        return new Date(value);
    }

    updateTime() {
        const currentTime = document.getElementById('current-time');
        if (!currentTime) return;

        currentTime.textContent = new Date().toLocaleString('en-KE', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Africa/Nairobi'
        });
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
    new QueueDisplay();
});
