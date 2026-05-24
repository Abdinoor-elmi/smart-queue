// Common utilities and functions shared across all interfaces

class SmartQueueAPI {
    constructor() {
        this.baseURL = '';
        this.ws = null;
        this.wsCallbacks = new Set();
    }

    // WebSocket connection
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.hideConnectionWarning();
            };
            
            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.wsCallbacks.forEach(callback => callback(data));
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket disconnected, attempting to reconnect...');
                this.showConnectionWarning('Connection lost. Reconnecting...');
                setTimeout(() => this.connectWebSocket(), 3000);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showConnectionWarning('Network problem. Live updates may be delayed.');
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
            this.showConnectionWarning('Unable to connect to live updates.');
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
        if (banner) {
            banner.classList.remove('show');
        }
    }

    // Add WebSocket message callback
    onWebSocketMessage(callback) {
        this.wsCallbacks.add(callback);
    }

    // Remove WebSocket message callback
    offWebSocketMessage(callback) {
        this.wsCallbacks.delete(callback);
    }

    // HTTP request helper
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: 'Request failed' }));
                const requestError = new Error(error.error || `HTTP ${response.status}`);
                requestError.status = response.status;
                throw requestError;
            }
            
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Authentication
    async login(username, password) {
        return this.request('/api/login', {
            method: 'POST',
            body: { username, password }
        });
    }

    async logout() {
        return this.request('/api/logout', {
            method: 'POST'
        });
    }

    // Services
    async getServices() {
        return this.request('/api/services');
    }

    async createService(serviceData) {
        return this.request('/api/services', {
            method: 'POST',
            body: serviceData
        });
    }

    async updateService(serviceId, serviceData) {
        return this.request(`/api/services/${serviceId}`, {
            method: 'PUT',
            body: serviceData
        });
    }

    async deleteService(serviceId) {
        return this.request(`/api/services/${serviceId}`, {
            method: 'DELETE'
        });
    }

    // Tickets
    async createTicket(serviceId) {
        return this.request('/api/tickets', {
            method: 'POST',
            body: { serviceId }
        });
    }

    async getQueue(serviceId) {
        return this.request(`/api/queue/${serviceId}`);
    }

    async updateTicketStatus(ticketId, status, counterId = null, options = {}) {
        const body = { status };
        if (counterId) {
            body.counterId = counterId;
        }
        Object.assign(body, options);
        return this.request(`/api/tickets/${ticketId}/status`, {
            method: 'PUT',
            body
        });
    }

    // Counters
    async getCounters() {
        return this.request('/api/counters');
    }
}

// Global API instance
const api = new SmartQueueAPI();

// Utility functions
const utils = {
    // Format time
    formatTime(date) {
        if (!date) return 'N/A';
        // SQLite stores timestamps in UTC format like "2024-03-13 11:54:00"
        // We need to append 'Z' to tell JavaScript it's UTC, or parse it correctly
        let d;
        if (typeof date === 'string' && !date.endsWith('Z') && date.includes(' ')) {
            // SQLite format: "YYYY-MM-DD HH:MM:SS" - treat as UTC
            d = new Date(date + ' UTC');
        } else {
            d = new Date(date);
        }
        
        return d.toLocaleTimeString('en-KE', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false,
            timeZone: 'Africa/Nairobi'
        });
    },

    // Format duration
    formatDuration(minutes) {
        if (!minutes || minutes < 1) return 'Less than 1 min';
        if (minutes < 60) return `${Math.round(minutes)} min`;
        
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours}h ${mins}m`;
    },

    // Calculate wait time from creation
    calculateWaitTime(createdAt) {
        const now = new Date();
        
        // Parse the created date correctly (SQLite stores in UTC)
        let created;
        if (typeof createdAt === 'string' && !createdAt.endsWith('Z') && createdAt.includes(' ')) {
            // SQLite format: "YYYY-MM-DD HH:MM:SS" - treat as UTC
            created = new Date(createdAt + ' UTC');
        } else {
            created = new Date(createdAt);
        }
        
        const diffMinutes = Math.floor((now - created) / (1000 * 60));
        return this.formatDuration(diffMinutes);
    },

    // Show notification
    showNotification(message, type = 'info', duration = 5000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 1.2rem; cursor: pointer;">&times;</button>
            </div>
        `;

        // Find or create notification container
        let container = document.getElementById('notification-panel');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-panel';
            container.className = 'notification-panel';
            document.body.appendChild(container);
        }

        container.appendChild(notification);

        // Auto remove after duration
        if (duration > 0) {
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, duration);
        }
    },

    // Show error
    showError(message, duration = 5000) {
        this.showNotification(message, 'error', duration);
    },

    // Show success
    showSuccess(message, duration = 3000) {
        this.showNotification(message, 'success', duration);
    },

    // Show loading
    showLoading(message = 'Loading...') {
        const existing = document.getElementById('loading-overlay');
        if (existing) return;

        const overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
            <div class="loading-content">
                <div class="loading-spinner"></div>
                <p>${message}</p>
            </div>
        `;
        document.body.appendChild(overlay);
    },

    // Hide loading
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Format ticket number for display
    formatTicketNumber(ticketNumber) {
        if (!ticketNumber) return 'N/A';
        return ticketNumber.toString().toUpperCase();
    },

    // Get status badge HTML
    getStatusBadge(status) {
        const badges = {
            waiting: '<span class="badge badge-waiting">Waiting to be called</span>',
            called: '<span class="badge badge-called">Called, awaiting service</span>',
            serving: '<span class="badge badge-serving">Being served</span>',
            completed: '<span class="badge badge-completed">Completed</span>',
            'no-show': '<span class="badge badge-no-show">No Show</span>',
            cancelled: '<span class="badge badge-cancelled">Cancelled</span>',
            canceled: '<span class="badge badge-cancelled">Cancelled</span>'
        };
        return badges[status] || `<span class="badge">${status}</span>`;
    },

    // Local storage helpers
    storage: {
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (error) {
                console.error('Failed to save to localStorage:', error);
            }
        },

        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (error) {
                console.error('Failed to read from localStorage:', error);
                return defaultValue;
            }
        },

        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (error) {
                console.error('Failed to remove from localStorage:', error);
            }
        }
    },

    // Session storage helpers (uses localStorage for persistence across refreshes)
    session: {
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (error) {
                console.error('Failed to save to localStorage:', error);
            }
        },

        get(key, defaultValue = null) {
            try {
                const item = localStorage.getItem(key);
                return item ? JSON.parse(item) : defaultValue;
            } catch (error) {
                console.error('Failed to read from localStorage:', error);
                return defaultValue;
            }
        },

        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (error) {
                console.error('Failed to remove from localStorage:', error);
            }
        }
    }
};

// Error handling
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    utils.showError('An unexpected error occurred. Please refresh the page.');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    utils.showError('A network error occurred. Please check your connection.');
});

// Initialize WebSocket connection when page loads
document.addEventListener('DOMContentLoaded', () => {
    api.connectWebSocket();
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { api, utils };
}
