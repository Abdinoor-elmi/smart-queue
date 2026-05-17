// Admin dashboard JavaScript

class AdminDashboard {
    constructor() {
        this.currentUser = null;
        this.currentSection = 'dashboard';
        this.services = [];
        this.counters = [];
        this.users = [];
        this.editingServiceId = null;
        this.editingCounterId = null;
        this.editingUserId = null;
        this.init();
    }

    async init() {
        // Check if user is logged in as admin
        const savedUser = utils.session.get('admin_user');
        if (savedUser && savedUser.role_name === 'admin') {
            const sessionUser = await this.getCurrentAdminSession();
            if (sessionUser) {
                this.currentUser = sessionUser;
                utils.session.set('admin_user', this.currentUser);
                this.hideLoginModal();
                this.showAdminInterface();
                await this.loadDashboard();
            } else {
                this.handleAuthExpired('Please log in again to continue.');
            }
        } else {
            this.redirectToLogin();
        }

        this.setupEventListeners();
        this.setupWebSocketHandlers();
        this.startPeriodicUpdates();
    }

    redirectToLogin() {
        this.showLoginModal();
    }

    showLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.classList.add('show');
    }

    hideLoginModal() {
        const modal = document.getElementById('login-modal');
        modal.classList.remove('show');
    }

    async getCurrentAdminSession() {
        try {
            const response = await api.request('/api/session');
            if (response.success && response.user.role_name === 'admin') {
                return response.user;
            }
        } catch (error) {
            if (error.status !== 401) {
                console.error('Failed to verify admin session:', error);
            }
        }

        return null;
    }

    showAdminInterface() {
        document.getElementById('admin-sidebar').style.display = 'block';
        document.getElementById('admin-main').style.display = 'block';
    }

    handleAuthExpired(message = 'Your admin session expired. Please log in again.') {
        utils.session.remove('admin_user');
        this.currentUser = null;
        this.showLoginModal();
        utils.showError(message);
    }

    async login(username, password) {
        try {
            utils.showLoading('Logging in...');
            
            const response = await api.login(username, password);
            
            if (response.success && response.user.role_name === 'admin') {
                this.currentUser = response.user;
                utils.session.set('admin_user', this.currentUser);
                
                this.hideLoginModal();
                this.showAdminInterface();
                await this.loadDashboard();
                utils.showSuccess('Admin login successful!');
            } else {
                throw new Error('Admin access required');
            }
        } catch (error) {
            console.error('Admin login failed:', error);
            utils.showError('Admin login failed. Please check your credentials.');
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
            utils.session.remove('admin_user');
            this.currentUser = null;
            window.location.href = '/';
        }
    }

    async loadDashboard() {
        try {
            utils.showLoading('Loading dashboard...');
            
            document.getElementById('admin-user').textContent = this.currentUser.username;
            
            await this.loadOverviewData();
            await this.loadServices();
            await this.loadCounters();
            
        } catch (error) {
            console.error('Failed to load dashboard:', error);
            utils.showError('Failed to load dashboard data.');
        } finally {
            utils.hideLoading();
        }
    }

    async loadOverviewData() {
        try {
            // Load overview statistics
            const services = await api.getServices();
            const counters = await api.getCounters();
            
            // Calculate totals from all tickets today
            let allTickets = [];
            
            for (const service of services) {
                try {
                    const response = await api.request(`/api/tickets/all/${service.service_id}`);
                    allTickets = allTickets.concat(response);
                } catch (error) {
                    console.error(`Failed to load tickets for service ${service.service_id}:`, error);
                }
            }
            
            // Filter tickets created today (in local timezone)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const todayTickets = allTickets.filter(t => {
                let ticketDate;
                if (typeof t.created_at === 'string' && !t.created_at.endsWith('Z') && t.created_at.includes(' ')) {
                    // SQLite format: treat as UTC
                    ticketDate = new Date(t.created_at + ' UTC');
                } else {
                    ticketDate = new Date(t.created_at);
                }
                return ticketDate >= today;
            });
            
            const totalTickets = todayTickets.length;
            const servedTickets = todayTickets.filter(t => t.status === 'completed').length;
            
            // Calculate average wait time from completed tickets
            const completedTickets = todayTickets.filter(t => t.status === 'completed' && t.completed_at);
            let avgWaitTime = 0;
            
            if (completedTickets.length > 0) {
                const totalWait = completedTickets.reduce((sum, ticket) => {
                    const completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                        ? new Date(ticket.completed_at + ' UTC')
                        : new Date(ticket.completed_at);
                    const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                        ? new Date(ticket.created_at + ' UTC')
                        : new Date(ticket.created_at);
                    const wait = (completedDate - createdDate) / (1000 * 60);
                    return sum + wait;
                }, 0);
                avgWaitTime = Math.round(totalWait / completedTickets.length);
            }
            
            // Update overview cards
            document.getElementById('total-tickets').textContent = totalTickets;
            document.getElementById('served-tickets').textContent = servedTickets;
            document.getElementById('avg-wait').textContent = `${avgWaitTime} min`;
            document.getElementById('active-counters').textContent = counters.filter(c => c.is_active).length;
            
        } catch (error) {
            console.error('Failed to load overview data:', error);
        }
    }

    async loadServices() {
        try {
            this.services = await api.getServices();
            this.renderServicesTable();
        } catch (error) {
            console.error('Failed to load services:', error);
        }
    }

    renderServicesTable() {
        const tbody = document.getElementById('services-table-body');
        
        if (!this.services || this.services.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-secondary);">
                        No services configured
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = this.services.map(service => `
            <tr>
                <td>${service.name}</td>
                <td>${service.avg_time ? service.avg_time + ' min' : 'No data yet'}</td>
                <td>
                    <span class="status-${service.is_active ? 'online' : 'offline'}">
                        ${service.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-icon btn-primary" onclick="adminDashboard.editService(${service.service_id})" title="Edit">
                            ✏️
                        </button>
                        <button class="btn btn-sm btn-icon btn-danger" onclick="adminDashboard.deleteService(${service.service_id})" title="Delete">
                            🗑️
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    async loadCounters() {
        try {
            this.counters = await api.getCounters();
        } catch (error) {
            console.error('Failed to load counters:', error);
        }
    }

    async saveService(serviceData) {
        try {
            utils.showLoading('Saving service...');
            
            if (this.editingServiceId) {
                await api.updateService(this.editingServiceId, serviceData);
                utils.showSuccess('Service updated successfully!');
                this.editingServiceId = null;
            } else {
                await api.createService(serviceData);
                utils.showSuccess('Service created successfully!');
            }
            
            await this.loadServices();
            document.getElementById('service-form').reset();
            document.querySelector('#service-form .btn-primary').textContent = 'Save Service';
            
        } catch (error) {
            console.error('Failed to save service:', error);
            utils.showError('Failed to save service.');
        } finally {
            utils.hideLoading();
        }
    }

    editService(serviceId) {
        const service = this.services.find(s => s.service_id === serviceId);
        if (service) {
            this.editingServiceId = serviceId;
            document.getElementById('service-name').value = service.name;
            document.querySelector('#service-form .btn-primary').textContent = 'Update Service';
            document.getElementById('service-form').scrollIntoView({ behavior: 'smooth' });
        }
    }

    async deleteService(serviceId) {
        if (!confirm('Are you sure you want to delete this service?')) {
            return;
        }

        try {
            utils.showLoading('Deleting service...');
            
            await api.deleteService(serviceId);
            
            await this.loadServices();
            utils.showSuccess('Service deleted successfully!');
            
        } catch (error) {
            console.error('Failed to delete service:', error);
            utils.showError('Failed to delete service.');
        } finally {
            utils.hideLoading();
        }
    }

    showSection(sectionName) {
        // Hide all sections
        document.querySelectorAll('.content-section').forEach(section => {
            section.classList.add('hidden');
        });

        // Show selected section
        const section = document.getElementById(`${sectionName}-section`);
        if (section) {
            section.classList.remove('hidden');
        }

        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const navItem = document.querySelector(`[data-section="${sectionName}"]`);
        if (navItem) {
            navItem.classList.add('active');
        }

        // Update page title
        const titles = {
            dashboard: 'Dashboard',
            queue: 'Queue Management',
            services: 'Services',
            counters: 'Counters',
            users: 'Users',
            analytics: 'Analytics',
            reports: 'Reports',
            settings: 'Settings'
        };
        
        document.getElementById('page-title').textContent = titles[sectionName] || 'Admin';
        this.currentSection = sectionName;

        // Load section-specific data
        this.loadSectionData(sectionName).catch(error => {
            console.error(`Failed to load ${sectionName} section:`, error);
            if (error.status === 401) {
                this.handleAuthExpired();
            } else {
                utils.showError(`Failed to load ${titles[sectionName] || 'section'} data.`);
            }
        });
    }

    async loadSectionData(sectionName) {
        switch (sectionName) {
            case 'dashboard':
                await this.loadOverviewData();
                await this.loadQueueActivity();
                break;
            case 'queue':
                // Ensure services and counters are loaded before loading queue
                if (this.services.length === 0) {
                    await this.loadServices();
                }
                if (this.counters.length === 0) {
                    await this.loadCounters();
                }
                await this.loadQueueData();
                break;
            case 'services':
                await this.loadServices();
                break;
            case 'counters':
                await this.loadCountersData();
                break;
            case 'analytics':
                await this.loadAnalyticsData();
                break;
            case 'users':
                await this.loadUsersData();
                break;
            case 'settings':
                await this.loadSettingsData();
                break;
        }
    }

    async loadSettingsData() {
        try {
            const settings = await api.request('/api/settings');
            document.getElementById('setting-called-timeout').value = settings.called_ticket_timeout_minutes || 2;
            document.getElementById('setting-second-chance').value = settings.second_chance_limit || 1;
            document.getElementById('setting-alert-ring').value = settings.alert_ring_seconds || 5;
            document.getElementById('setting-auto-refresh').value = settings.auto_refresh_seconds || 30;
        } catch (error) {
            console.error('Failed to load settings:', error);
            if (error.status === 401) {
                this.handleAuthExpired();
                return;
            }
            utils.showError('Failed to load settings.');
        }
    }

    async saveSettings() {
        try {
            utils.showLoading('Saving settings...');
            await api.request('/api/settings', {
                method: 'PUT',
                body: {
                    called_ticket_timeout_minutes: document.getElementById('setting-called-timeout').value,
                    second_chance_limit: document.getElementById('setting-second-chance').value,
                    alert_ring_seconds: document.getElementById('setting-alert-ring').value,
                    auto_refresh_seconds: document.getElementById('setting-auto-refresh').value
                }
            });
            utils.showSuccess('Settings saved successfully.');
            await this.loadSettingsData();
        } catch (error) {
            console.error('Failed to save settings:', error);
            utils.showError('Failed to save settings.');
        } finally {
            utils.hideLoading();
        }
    }

    async loadCountersData() {
        try {
            const tbody = document.getElementById('counters-table-body');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading...</td></tr>';
            
            // Always reload counters
            this.counters = await api.getCounters();
            
            // Populate counter service dropdown
            await this.populateCounterServiceDropdown();
            
            if (this.counters.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: var(--text-secondary);">
                            No counters configured
                        </td>
                    </tr>
                `;
                return;
            }
            
            tbody.innerHTML = this.counters.map(counter => `
                <tr>
                    <td>${counter.name}</td>
                    <td>${counter.service_name}</td>
                    <td>${counter.location || 'N/A'}</td>
                    <td>
                        <span class="status-${counter.is_active ? 'online' : 'offline'}">
                            ${counter.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-sm btn-icon btn-primary" title="Edit" onclick="adminDashboard.editCounter(${counter.counter_id})">
                                ✏️
                            </button>
                            <button class="btn btn-sm btn-icon btn-danger" title="Delete" onclick="adminDashboard.deleteCounter(${counter.counter_id})">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
            
        } catch (error) {
            console.error('Failed to load counters data:', error);
            const tbody = document.getElementById('counters-table-body');
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--danger-color);">
                        Failed to load counters
                    </td>
                </tr>
            `;
        }
    }

    async populateCounterServiceDropdown() {
        const select = document.getElementById('counter-service');
        if (!select) return;
        
        if (this.services.length === 0) {
            await this.loadServices();
        }
        
        select.innerHTML = '<option value="">Select Service</option>' + 
            this.services.map(s => `<option value="${s.service_id}">${s.name}</option>`).join('');
    }

    async saveCounter(counterData) {
        try {
            utils.showLoading('Saving counter...');
            
            if (this.editingCounterId) {
                await api.request(`/api/counters/${this.editingCounterId}`, {
                    method: 'PUT',
                    body: counterData
                });
                utils.showSuccess('Counter updated successfully!');
                this.editingCounterId = null;
            } else {
                await api.request('/api/counters', {
                    method: 'POST',
                    body: counterData
                });
                utils.showSuccess('Counter created successfully!');
            }
            
            document.getElementById('counter-form').reset();
            document.querySelector('#counter-form .btn-primary').textContent = 'Save Counter';
            await this.loadCountersData();
            
        } catch (error) {
            console.error('Failed to save counter:', error);
            utils.showError('Failed to save counter.');
        } finally {
            utils.hideLoading();
        }
    }

    editCounter(counterId) {
        const counter = this.counters.find(c => c.counter_id === counterId);
        if (counter) {
            this.editingCounterId = counterId;
            document.getElementById('counter-name').value = counter.name;
            document.getElementById('counter-service').value = counter.service_id;
            document.getElementById('counter-location').value = counter.location || '';
            
            document.querySelector('#counter-form .btn-primary').textContent = 'Update Counter';
            document.getElementById('counter-form').scrollIntoView({ behavior: 'smooth' });
        }
    }

    cancelCounterEdit() {
        this.editingCounterId = null;
        document.getElementById('counter-form').reset();
        document.querySelector('#counter-form .btn-primary').textContent = 'Save Counter';
    }

    async deleteCounter(counterId) {
        if (!confirm('Are you sure you want to delete this counter?')) {
            return;
        }

        try {
            utils.showLoading('Deleting counter...');
            
            await api.request(`/api/counters/${counterId}`, {
                method: 'DELETE'
            });
            
            utils.showSuccess('Counter deleted successfully!');
            await this.loadCountersData();
            
        } catch (error) {
            console.error('Failed to delete counter:', error);
            utils.showError('Failed to delete counter.');
        } finally {
            utils.hideLoading();
        }
    }

    async loadAnalyticsData() {
        try {
            // Load all tickets for analytics
            const services = await api.getServices();
            let allTickets = [];
            
            for (const service of services) {
                try {
                    const response = await api.request(`/api/tickets/all/${service.service_id}`);
                    allTickets = allTickets.concat(response);
                } catch (error) {
                    console.error(`Failed to load tickets for service ${service.service_id}:`, error);
                }
            }
            
            // Calculate analytics
            const totalTickets = allTickets.length;
            const completedTickets = allTickets.filter(t => t.status === 'completed');
            const noShowTickets = allTickets.filter(t => t.status === 'no-show');
            
            const completionRate = totalTickets > 0 
                ? Math.round((completedTickets.length / totalTickets) * 100) 
                : 0;
            
            const noShowRate = totalTickets > 0 
                ? Math.round((noShowTickets.length / totalTickets) * 100) 
                : 0;
            // Calculate average service time
            let avgServiceTime = 0;
            if (completedTickets.length > 0) {
                const totalTime = completedTickets.reduce((sum, ticket) => {
                    if (!ticket.completed_at) return sum;
                    const completedDate = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z') && ticket.completed_at.includes(' ')
                        ? new Date(ticket.completed_at + ' UTC')
                        : new Date(ticket.completed_at);
                    const createdDate = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z') && ticket.created_at.includes(' ')
                        ? new Date(ticket.created_at + ' UTC')
                        : new Date(ticket.created_at);
                    const serviceTime = (completedDate - createdDate) / (1000 * 60);
                    return sum + serviceTime;
                }, 0);
                avgServiceTime = Math.round(totalTime / completedTickets.length);
            }
            
            // Update analytics display
            document.getElementById('analytics-total-tickets').textContent = totalTickets;
            document.getElementById('analytics-completion-rate').textContent = `${completionRate}%`;
            document.getElementById('analytics-avg-time').textContent = `${avgServiceTime} min`;
            document.getElementById('analytics-noshow-rate').textContent = `${noShowRate}%`;
            
        } catch (error) {
            console.error('Failed to load analytics data:', error);
        }
    }

    async loadQueueActivity(period = 'today') {
        try {
            const chartContent = document.getElementById('queue-activity-chart');
            if (!chartContent) return;
            
            // Load all tickets
            const services = await api.getServices();
            let allTickets = [];
            
            for (const service of services) {
                try {
                    const response = await api.request(`/api/tickets/all/${service.service_id}`);
                    allTickets = allTickets.concat(response);
                } catch (error) {
                    console.error(`Failed to load tickets for service ${service.service_id}:`, error);
                }
            }
            
            // Determine filter start date
            const now = new Date();
            let startDate = new Date();
            if (period === 'today') {
                startDate.setHours(0, 0, 0, 0);
            } else if (period === 'week') {
                startDate.setDate(now.getDate() - now.getDay());
                startDate.setHours(0, 0, 0, 0);
            } else if (period === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            }
            
            const filteredTickets = allTickets.filter(t => {
                const ticketDate = typeof t.created_at === 'string' && !t.created_at.endsWith('Z') && t.created_at.includes(' ')
                    ? new Date(t.created_at + ' UTC')
                    : new Date(t.created_at);
                return ticketDate >= startDate;
            });
            
            // Group by status
            const waiting = filteredTickets.filter(t => t.status === 'waiting').length;
            const called = filteredTickets.filter(t => t.status === 'called').length;
            const serving = filteredTickets.filter(t => t.status === 'serving').length;
            const completed = filteredTickets.filter(t => t.status === 'completed').length;
            const noShow = filteredTickets.filter(t => t.status === 'no-show').length;
            const cancelled = filteredTickets.filter(t => t.status === 'cancelled').length;
            const total = filteredTickets.length;
            
            chartContent.innerHTML = total === 0
                ? '<p style="text-align:center; padding:2rem; color:var(--text-secondary);">No tickets for this period</p>'
                : `
                <table class="data-table" style="margin: 0;">
                    <thead>
                        <tr>
                            <th>Status</th>
                            <th>Count</th>
                            <th>Percentage</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><span class="badge badge-waiting">Waiting to be called</span></td>
                            <td>${waiting}</td>
                            <td>${total > 0 ? Math.round((waiting / total) * 100) : 0}%</td>
                        </tr>
                        <tr>
                            <td><span class="badge badge-called">Called, awaiting service</span></td>
                            <td>${called}</td>
                            <td>${total > 0 ? Math.round((called / total) * 100) : 0}%</td>
                        </tr>
                        <tr>
                            <td><span class="badge badge-serving">Being served</span></td>
                            <td>${serving}</td>
                            <td>${total > 0 ? Math.round((serving / total) * 100) : 0}%</td>
                        </tr>
                        <tr>
                            <td><span class="badge badge-completed">Completed</span></td>
                            <td>${completed}</td>
                            <td>${total > 0 ? Math.round((completed / total) * 100) : 0}%</td>
                        </tr>
                        <tr>
                            <td><span class="badge badge-no-show">No-Show</span></td>
                            <td>${noShow}</td>
                            <td>${total > 0 ? Math.round((noShow / total) * 100) : 0}%</td>
                        </tr>
                        <tr>
                            <td><span class="badge badge-cancelled">Cancelled</span></td>
                            <td>${cancelled}</td>
                            <td>${total > 0 ? Math.round((cancelled / total) * 100) : 0}%</td>
                        </tr>
                    </tbody>
                </table>
            `;
            
        } catch (error) {
            console.error('Failed to load queue activity:', error);
            const chartContent = document.getElementById('queue-activity-chart');
            if (chartContent) {
                chartContent.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--danger-color);">Failed to load data</p>';
            }
        }
    }

    async loadUsersData() {
        try {
            const tbody = document.getElementById('users-table-body');
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Loading...</td></tr>';
            
            // Get all users from database
            const users = await api.request('/api/users');
            this.users = users;
            
            // Populate form dropdowns
            await this.populateUserRoleDropdown();
            await this.populateUserCounterDropdown();
            
            if (users.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: var(--text-secondary);">
                            No users found
                        </td>
                    </tr>
                `;
                return;
            }
            
            tbody.innerHTML = users.map(user => `
                <tr>
                    <td>${user.username}</td>
                    <td><span class="badge badge-${user.role_name === 'admin' ? 'primary' : 'secondary'}">${user.role_name}</span></td>
                    <td>${user.counter_name || '-'}</td>
                    <td><span class="status-online">Active</span></td>
                    <td>
                        <div class="action-buttons">
                            ${user.username !== 'admin' ? `
                                <button class="btn btn-sm btn-icon btn-primary" title="Edit" onclick="adminDashboard.editUser(${user.user_id})">
                                    ✏️
                                </button>
                                <button class="btn btn-sm btn-icon btn-danger" title="Delete" onclick="adminDashboard.deleteUser(${user.user_id}, '${user.username}')">
                                    🗑️
                                </button>
                            ` : '<span style="color: var(--text-secondary);">System Admin</span>'}
                        </div>
                    </td>
                </tr>
            `).join('');
            
        } catch (error) {
            console.error('Failed to load users:', error);
            if (error.status === 401) {
                this.handleAuthExpired();
            }
            const tbody = document.getElementById('users-table-body');
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--danger-color);">
                        ${error.status === 401 ? 'Please log in again to load users' : 'Failed to load users'}
                    </td>
                </tr>
            `;
        }
    }

    async populateUserCounterDropdown() {
        const select = document.getElementById('user-counter');
        if (!select) return;
        
        if (this.counters.length === 0) {
            this.counters = await api.getCounters();
        }
        
        select.innerHTML = '<option value="">No Counter (Admin/Viewer)</option>' + 
            this.counters.map(c => `<option value="${c.counter_id}">${c.name} - ${c.service_name}</option>`).join('');
    }

    async populateUserRoleDropdown() {
        const select = document.getElementById('user-role');
        if (!select) return;

        const roles = await api.request('/api/roles');
        const preferredOrder = ['staff', 'admin', 'manager', 'viewer'];

        roles.sort((a, b) => {
            const aIndex = preferredOrder.indexOf(a.role_name);
            const bIndex = preferredOrder.indexOf(b.role_name);
            return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
        });

        select.innerHTML = roles.map(role => `
            <option value="${role.role_id}">${role.role_name.charAt(0).toUpperCase() + role.role_name.slice(1)}</option>
        `).join('');
    }


    async createUser(userData) {
        try {
            utils.showLoading('Saving user...');
            
            if (this.editingUserId) {
                // Update existing user
                await api.request(`/api/users/${this.editingUserId}`, {
                    method: 'PUT',
                    body: userData
                });
                utils.showSuccess('User updated successfully!');
                this.editingUserId = null;
            } else {
                // Create new user
                await api.request('/api/users', {
                    method: 'POST',
                    body: userData
                });
                utils.showSuccess('User created successfully!');
            }
            
            document.getElementById('user-form').reset();
            document.querySelector('#user-form .btn-primary').textContent = 'Create User';
            await this.loadUsersData();
            
        } catch (error) {
            console.error('Failed to save user:', error);
            utils.showError('Failed to save user. Username may already exist.');
        } finally {
            utils.hideLoading();
        }
    }

    editUser(userId) {
        const user = this.users.find(u => u.user_id === userId);
        if (!user) return;
        
        this.editingUserId = userId;
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-password').value = '';
        document.getElementById('user-password').placeholder = 'Leave blank to keep current password';
        document.getElementById('password-hint').textContent = '(optional when editing)';
        document.getElementById('user-role').value = user.role_id;
        document.getElementById('user-counter').value = user.counter_id || '';
        document.getElementById('user-form-title').textContent = `Edit User: ${user.username}`;
        document.querySelector('#user-form .btn-primary').textContent = 'Update User';
        document.getElementById('user-form').scrollIntoView({ behavior: 'smooth' });
    }

    cancelUserEdit() {
        this.editingUserId = null;
        document.getElementById('user-form').reset();
        document.getElementById('user-password').placeholder = '';
        document.getElementById('password-hint').textContent = '';
        document.getElementById('user-form-title').textContent = 'Add New User';
        document.querySelector('#user-form .btn-primary').textContent = 'Create User';
    }

    viewTicket(ticketId) {
        api.request(`/api/tickets/${ticketId}`).then(ticket => {
            this.showTicketModal(ticket);
        }).catch(() => {
            utils.showError('Could not load ticket details.');
        });
    }

    showTicketModal(ticket) {
        const modal = document.getElementById('ticket-modal');
        const body = document.getElementById('ticket-modal-body');

        const counter = this.counters.find(c => c.counter_id === ticket.counter_id);
        const counterName = counter ? counter.name : (ticket.counter_id ? `Counter ${ticket.counter_id}` : 'Not assigned');

        const fmt = (dt) => {
            if (!dt) return '-';
            const d = typeof dt === 'string' && !dt.endsWith('Z') && dt.includes(' ')
                ? new Date(dt + ' UTC') : new Date(dt);
            return d.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', hour12: false });
        };

        // Calculate total time if completed
        let totalTime = '-';
        if (ticket.created_at && ticket.completed_at) {
            const created = typeof ticket.created_at === 'string' && !ticket.created_at.endsWith('Z')
                ? new Date(ticket.created_at + ' UTC') : new Date(ticket.created_at);
            const completed = typeof ticket.completed_at === 'string' && !ticket.completed_at.endsWith('Z')
                ? new Date(ticket.completed_at + ' UTC') : new Date(ticket.completed_at);
            const mins = Math.round((completed - created) / 60000);
            totalTime = `${mins} min`;
        }

        body.innerHTML = `
            <div style="text-align:center; padding:1rem; background:var(--background-color); border-radius:8px; margin-bottom:1rem;">
                <div style="font-size:2.5rem; font-weight:bold; color:var(--primary-color);">
                    ${utils.formatTicketNumber(ticket.ticket_number)}
                </div>
                <div style="margin-top:0.5rem;">${utils.getStatusBadge(ticket.status)}</div>
            </div>
            <table style="width:100%; border-collapse:collapse;">
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary); width:45%;">Service</td>
                    <td style="padding:0.75rem 0; font-weight:500;">${ticket.service_name || '-'}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Counter</td>
                    <td style="padding:0.75rem 0; font-weight:500;">${counterName}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Created</td>
                    <td style="padding:0.75rem 0;">${fmt(ticket.created_at)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Called</td>
                    <td style="padding:0.75rem 0;">${fmt(ticket.called_at)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Serving Started</td>
                    <td style="padding:0.75rem 0;">${fmt(ticket.served_at)}</td>
                </tr>
                <tr style="border-bottom:1px solid var(--border-color);">
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Completed</td>
                    <td style="padding:0.75rem 0;">${fmt(ticket.completed_at)}</td>
                </tr>
                <tr>
                    <td style="padding:0.75rem 0; color:var(--text-secondary);">Total Time</td>
                    <td style="padding:0.75rem 0; font-weight:500;">${totalTime}</td>
                </tr>
            </table>
            ${!['completed', 'no-show', 'cancelled'].includes(ticket.status) ? `
                <div style="margin-top:1.5rem; padding:1rem; border:1px solid var(--border-color); border-radius:8px; background:var(--background-color);">
                    <div style="font-weight:800; margin-bottom:0.75rem;">Transfer Ticket</div>
                    <div class="grid grid-2" style="gap:0.75rem;">
                        <div>
                            <label class="form-label">Service</label>
                            <select class="form-control" id="transfer-service">
                                ${this.services.map(service => `
                                    <option value="${service.service_id}" ${service.service_id === ticket.service_id ? 'selected' : ''}>
                                        ${service.name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="form-label">Counter</label>
                            <select class="form-control" id="transfer-counter">
                                <option value="">Auto assign by service</option>
                                ${this.counters.map(counter => `
                                    <option value="${counter.counter_id}" ${counter.counter_id === ticket.counter_id ? 'selected' : ''}>
                                        ${counter.name}
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                    <div style="margin-top:0.75rem; text-align:right;">
                        <button class="btn btn-primary" onclick="adminDashboard.transferTicket(${ticket.ticket_id})">Transfer</button>
                    </div>
                </div>
            ` : ''}
            <div style="margin-top:1.5rem; text-align:right;">
                <button class="btn btn-secondary" onclick="adminDashboard.closeTicketModal()">Close</button>
            </div>
        `;

        modal.classList.add('show');
    }

    closeTicketModal() {
        document.getElementById('ticket-modal').classList.remove('show');
    }

    async transferTicket(ticketId) {
        const serviceId = Number.parseInt(document.getElementById('transfer-service').value, 10);
        const counterValue = document.getElementById('transfer-counter').value;
        const counterId = counterValue ? Number.parseInt(counterValue, 10) : null;

        try {
            utils.showLoading('Transferring ticket...');
            await api.request(`/api/tickets/${ticketId}/transfer`, {
                method: 'PUT',
                body: { serviceId, counterId }
            });
            utils.showSuccess('Ticket transferred successfully.');
            this.closeTicketModal();
            await this.loadQueueData();
        } catch (error) {
            console.error('Failed to transfer ticket:', error);
            utils.showError('Failed to transfer ticket.');
        } finally {
            utils.hideLoading();
        }
    }

    async deleteUser(userId, username) {
        if (!confirm(`Are you sure you want to delete user "${username}"?`)) {
            return;
        }

        try {
            utils.showLoading('Deleting user...');
            
            await api.request(`/api/users/${userId}`, {
                method: 'DELETE'
            });
            
            utils.showSuccess('User deleted successfully!');
            await this.loadUsersData();
            
        } catch (error) {
            console.error('Failed to delete user:', error);
            utils.showError('Failed to delete user.');
        } finally {
            utils.hideLoading();
        }
    }

    async loadQueueData() {
        try {
            const tbody = document.getElementById('queue-table-body');
            tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
            
            let allTickets = [];
            
            for (const service of this.services) {
                try {
                    // Get all tickets including completed ones
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
            
            // Sort by created_at descending (newest first)
            allTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            if (allTickets.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; color: var(--text-secondary);">
                            No tickets found
                        </td>
                    </tr>
                `;
                return;
            }
            
            // Get counter name from counter_id
            const getCounterName = (ticket) => {
                // Only show counter for tickets that have been served or are serving
                if (ticket.status !== 'serving' && ticket.status !== 'completed') {
                    return '-';
                }
                
                if (!ticket.counter_id) return 'Not assigned';
                
                const counter = this.counters.find(c => c.counter_id === ticket.counter_id);
                return counter ? counter.name : `Counter ${ticket.counter_id}`;
            };
            
            tbody.innerHTML = allTickets.map(ticket => `
                <tr>
                    <td>${utils.formatTicketNumber(ticket.ticket_number)}</td>
                    <td>${ticket.service_name}</td>
                    <td>${utils.getStatusBadge(ticket.status)}</td>
                    <td>${utils.calculateWaitTime(ticket.created_at)}</td>
                    <td>${getCounterName(ticket)}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-sm btn-icon btn-primary" title="View Details" onclick="adminDashboard.viewTicket(${ticket.ticket_id})">
                                👁️
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
            
        } catch (error) {
            console.error('Failed to load queue data:', error);
            const tbody = document.getElementById('queue-table-body');
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--danger-color);">
                        Failed to load queue data
                    </td>
                </tr>
            `;
        }
    }

    async closeDay() {
        if (!confirm('Close the day now? All active waiting, called, and serving tickets will be marked as no-show.')) {
            return;
        }

        try {
            utils.showLoading('Closing day...');
            await api.request('/api/admin/close-day', { method: 'POST' });
            utils.showSuccess('Day closed successfully.');
            await this.loadSectionData(this.currentSection);
        } catch (error) {
            console.error('Failed to close day:', error);
            utils.showError('Failed to close day.');
        } finally {
            utils.hideLoading();
        }
    }

    toggleSidebar() {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }

    setupEventListeners() {
        // Login form
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            this.login(username, password);
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const section = item.dataset.section;
                if (section) {
                    this.showSection(section);
                }
            });
        });

        // Mobile sidebar toggle
        document.getElementById('sidebar-toggle').addEventListener('click', () => {
            this.toggleSidebar();
        });

        // Sidebar overlay
        document.getElementById('sidebar-overlay').addEventListener('click', () => {
            this.toggleSidebar();
        });

        // Logout button
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.logout();
        });

        // Service form
        document.getElementById('service-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const serviceData = {
                name: document.getElementById('service-name').value,
                default_avg_time: 5  // default fallback, will be overridden by calculated avg
            };
            this.saveService(serviceData);
        });

        // User form
        document.getElementById('user-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('user-password').value;
            const counterValue = document.getElementById('user-counter').value;
            const userData = {
                username: document.getElementById('user-username').value,
                role_id: parseInt(document.getElementById('user-role').value),
                counter_id: counterValue ? parseInt(counterValue) : null
            };
            // Only include password if provided
            if (password) userData.password = password;
            // Password required for new users
            if (!this.editingUserId && !password) {
                utils.showError('Password is required for new users.');
                return;
            }
            this.createUser(userData);
        });

        // Queue activity period filter
        const periodFilter = document.getElementById('activity-period-filter');
        if (periodFilter) {
            periodFilter.addEventListener('change', () => {
                this.loadQueueActivity(periodFilter.value);
            });
        }

        // Counter form
        document.getElementById('counter-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const counterData = {
                name: document.getElementById('counter-name').value,
                service_id: parseInt(document.getElementById('counter-service').value),
                location: document.getElementById('counter-location').value,
                is_active: 1
            };
            this.saveCounter(counterData);
        });

        const settingsForm = document.getElementById('settings-form');
        if (settingsForm) {
            settingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveSettings();
            });
        }

        const reloadSettingsBtn = document.getElementById('reload-settings-btn');
        if (reloadSettingsBtn) {
            reloadSettingsBtn.addEventListener('click', () => this.loadSettingsData());
        }

        const closeDayBtn = document.getElementById('close-day-btn');
        if (closeDayBtn) {
            closeDayBtn.addEventListener('click', () => this.closeDay());
        }
    }

    setupWebSocketHandlers() {
        api.onWebSocketMessage((data) => {
            if (data.type === 'queue_update' || data.type === 'ticket_update') {
                // Refresh current section data
                this.loadSectionData(this.currentSection);
            }
        });
    }

    startPeriodicUpdates() {
        // Refresh dashboard data every 30 seconds
        setInterval(() => {
            if (this.currentSection === 'dashboard') {
                this.loadOverviewData();
            } else if (this.currentSection === 'queue') {
                this.loadQueueData();
            }
        }, 30000);
    }
}

// Global instance
let adminDashboard;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    adminDashboard = new AdminDashboard();
});
