const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const session = require('express-session');
const path = require('path');
const Database = require('./database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Trust proxy for HTTPS on hosting platforms
app.set('trust proxy', 1);

// Initialize database
const db = new Database();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'smartqueue-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// WebSocket connections storage
const clients = new Set();

// WebSocket connection handling
wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('New WebSocket connection');

    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket connection closed');
    });
});

// Broadcast function for real-time updates
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function processCalledTicketTimeouts() {
    getSystemSettings((err, settings) => {
        if (err) {
            console.error('Failed to read system settings:', err);
            return;
        }

        const timeoutMinutes = parseNumberSetting(settings.called_ticket_timeout_minutes, 2, 1, 60);
        const secondChanceLimit = parseNumberSetting(settings.second_chance_limit, 1, 0, 5);

        db.db.all(
            `SELECT *
             FROM tickets
             WHERE status = 'called'
               AND called_at IS NOT NULL
               AND ((julianday('now') - julianday(called_at)) * 24 * 60) >= ?`,
            [timeoutMinutes],
            (err, tickets) => {
                if (err) {
                    console.error('Failed to process called ticket timeouts:', err);
                    return;
                }

                tickets.forEach(ticket => handleCalledTicketTimeout(ticket, secondChanceLimit));
            }
        );
    });
}

function getSystemSettings(callback) {
    db.db.all(`SELECT setting_key, setting_value FROM system_settings`, (err, rows) => {
        if (err) {
            callback(err);
            return;
        }

        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        callback(null, settings);
    });
}

function parseNumberSetting(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function handleCalledTicketTimeout(ticket, secondChanceLimit) {
    if ((ticket.missed_calls || 0) >= secondChanceLimit) {
        db.db.run(
            `UPDATE tickets
             SET status = 'no-show',
                 completed_at = CURRENT_TIMESTAMP,
                 counter_id = NULL
             WHERE ticket_id = ? AND status = 'called'`,
            [ticket.ticket_id],
            (err) => {
            if (err) {
                    console.error('Failed to mark ticket no-show:', err);
                    return;
                }

                broadcast({
                    type: 'ticket_update',
                    ticketId: ticket.ticket_id,
                    status: 'no-show'
                });
            }
        );
        return;
    }

    db.db.run(
        `UPDATE tickets
         SET status = 'waiting',
             missed_calls = missed_calls + 1,
             called_at = NULL,
             counter_id = NULL
         WHERE ticket_id = ? AND status = 'called'`,
        [ticket.ticket_id],
        (err) => {
            if (err) {
                console.error('Failed to return missed ticket to queue:', err);
                return;
            }

            broadcast({
                type: 'ticket_update',
                ticketId: ticket.ticket_id,
                status: 'waiting',
                missed: true
            });

            autoCallNextTicket(ticket.service_id, ticket.counter_id, ticket.ticket_id);
        }
    );
}

function autoCallNextTicket(serviceId, counterId, excludedTicketId) {
    db.db.get(
        `SELECT ticket_id
         FROM tickets
         WHERE service_id = ?
           AND status = 'waiting'
           AND ticket_id != ?
         ORDER BY CASE WHEN missed_calls > 0 THEN 0 ELSE 1 END,
                  created_at
         LIMIT 1`,
        [serviceId, excludedTicketId],
        (err, nextTicket) => {
            if (err) {
                console.error('Failed to find next ticket after missed call:', err);
                return;
            }

            if (!nextTicket) return;

            db.updateTicketStatus(nextTicket.ticket_id, 'called', counterId, (err) => {
                if (err) {
                    console.error('Failed to auto-call next ticket:', err);
                    return;
                }

                broadcast({
                    type: 'ticket_update',
                    ticketId: nextTicket.ticket_id,
                    status: 'called',
                    autoCalled: true
                });
            });
        }
    );
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.session.user.role_name)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Routes

// Authentication
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.authenticateUser(username, password, (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.user = user;
        req.session.save((saveErr) => {
            if (saveErr) {
                return res.status(500).json({ error: 'Failed to save session' });
            }

            res.json({
                success: true,
                user: {
                    username: user.username,
                    role_name: user.role_name,
                    counter_id: user.counter_id,
                    counter_name: user.counter_name,
                    service_id: user.service_id
                }
            });
        });
    });
});

app.get('/api/session', requireAuth, (req, res) => {
    const user = req.session.user;
    res.json({
        success: true,
        user: {
            username: user.username,
            role_name: user.role_name,
            counter_id: user.counter_id,
            counter_name: user.counter_name,
            service_id: user.service_id
        }
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Get single ticket by ID
app.get('/api/tickets/:ticketId', (req, res) => {
    const { ticketId } = req.params;
    db.db.get(
        `SELECT t.*, s.name as service_name
         FROM tickets t
         JOIN services s ON t.service_id = s.service_id
         WHERE t.ticket_id = ?`,
        [ticketId],
        (err, ticket) => {
            if (err) return res.status(500).json({ error: 'Failed to get ticket' });
            if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
            res.json(ticket);
        }
    );
});

// Get all tickets for a service (including completed)
app.get('/api/tickets/all/:serviceId', (req, res) => {
    const serviceId = req.params.serviceId;
    
    db.db.all(
        `SELECT t.*, s.name as service_name 
         FROM tickets t 
         JOIN services s ON t.service_id = s.service_id 
         WHERE t.service_id = ? 
         ORDER BY t.created_at DESC`,
        [serviceId],
        (err, tickets) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to get tickets' });
            }
            res.json(tickets);
        }
    );
});

// Ticket operations
app.post('/api/tickets', (req, res) => {
    const { serviceId } = req.body;
    
    db.createTicket(serviceId, (err, ticketId, ticketNumber) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to create ticket' });
        }
        
        // Get estimated wait time
        db.getMovingAverage(serviceId, (err, avgTime) => {
            db.getQueueStatus(serviceId, (err, queue) => {
                db.db.get(
                    'SELECT COUNT(*) as count FROM counters WHERE service_id = ? AND is_active = 1',
                    [serviceId],
                    (err, row) => {
                        const activeCounters = Math.max(row ? row.count : 0, 1);
                        const position = queue.findIndex(ticket => ticket.ticket_id === ticketId) + 1 || queue.length;
                        const customersAhead = Math.max(position - 1, 0);
                        const estimatedWait = Math.ceil(customersAhead * (avgTime || 5) / activeCounters);
                
                        const ticketData = {
                            ticketId,
                            ticketNumber,
                            position,
                            estimatedWait
                        };
                
                        // Broadcast queue update
                        broadcast({
                            type: 'queue_update',
                            serviceId,
                            queue: queue.length
                        });
                
                        res.json(ticketData);
                    }
                );
            });
        });
    });
});

app.get('/api/queue/:serviceId', (req, res) => {
    const serviceId = req.params.serviceId;
    
    db.getQueueStatus(serviceId, (err, tickets) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to get queue status' });
        }
        
        res.json(tickets);
    });
});

app.put('/api/tickets/:ticketId/cancel', (req, res) => {
    const { ticketId } = req.params;

    db.db.run(
        `UPDATE tickets
         SET status = 'cancelled',
             completed_at = CURRENT_TIMESTAMP,
             counter_id = NULL
         WHERE ticket_id = ?
           AND status IN ('waiting', 'called', 'serving')`,
        [ticketId],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to cancel ticket' });
            }

            if (this.changes === 0) {
                return res.status(409).json({ error: 'Ticket cannot be cancelled' });
            }

            broadcast({
                type: 'ticket_update',
                ticketId,
                status: 'cancelled'
            });

            res.json({ success: true });
        }
    );
});

app.put('/api/tickets/:ticketId/status', requireRole('admin', 'staff'), (req, res) => {
    const { ticketId } = req.params;
    const { status, counterId } = req.body;
    
    db.updateTicketStatus(ticketId, status, counterId, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update ticket status' });
        }
        
        // Create service transaction when serving starts
        if (status === 'serving' && counterId) {
            db.createServiceTransaction(ticketId, counterId, (err) => {
                if (err) {
                    console.error('Failed to create service transaction:', err);
                }
            });
        }
        
        // Complete service transaction when ticket is completed
        if (status === 'completed') {
            db.completeServiceTransaction(ticketId, (err) => {
                if (err) {
                    console.error('Failed to complete service transaction:', err);
                }
            });
        }
        
        // Broadcast status update
        broadcast({
            type: 'ticket_update',
            ticketId,
            status
        });
        
        res.json({ success: true });
    });
});

app.put('/api/tickets/:ticketId/transfer', requireRole('admin', 'manager'), (req, res) => {
    const { ticketId } = req.params;
    const { serviceId, counterId } = req.body;

    if (!serviceId) {
        return res.status(400).json({ error: 'Service is required' });
    }

    db.db.run(
        `UPDATE tickets
         SET service_id = ?,
             counter_id = ?,
             status = CASE WHEN status IN ('completed', 'no-show', 'cancelled') THEN status ELSE 'waiting' END,
             called_at = NULL,
             served_at = NULL
         WHERE ticket_id = ?`,
        [serviceId, counterId || null, ticketId],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed to transfer ticket' });

            db.db.get(
                `SELECT t.*, s.name as service_name, c.name as counter_name
                 FROM tickets t
                 JOIN services s ON t.service_id = s.service_id
                 LEFT JOIN counters c ON t.counter_id = c.counter_id
                 WHERE t.ticket_id = ?`,
                [ticketId],
                (selectErr, ticket) => {
                    if (selectErr || !ticket) {
                        return res.status(500).json({ error: 'Failed to load transferred ticket' });
                    }

                    broadcast({
                        type: 'ticket_update',
                        ticketId: ticket.ticket_id,
                        status: ticket.status,
                        transferred: true,
                        ticket
                    });
                    res.json({ success: true, ticket });
                }
            );
        }
    );
});

app.post('/api/admin/close-day', requireRole('admin'), (req, res) => {
    db.db.run(
        `UPDATE tickets
         SET status = 'no-show',
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             counter_id = NULL
         WHERE status IN ('waiting', 'called', 'serving')`,
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed to close day' });

            broadcast({ type: 'queue_update', closedDay: true });
            res.json({ success: true });
        }
    );
});

// Services
app.post('/api/services', requireRole('admin'), (req, res) => {
    const { name, default_avg_time } = req.body;
    
    if (!name || !default_avg_time) {
        return res.status(400).json({ error: 'Name and default average time are required' });
    }
    
    db.db.run(
        'INSERT INTO services (name, default_avg_time) VALUES (?, ?)',
        [name, default_avg_time],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to create service' });
            }
            res.json({ success: true, serviceId: this.lastID });
        }
    );
});

app.put('/api/services/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { name, default_avg_time } = req.body;
    
    db.db.run(
        'UPDATE services SET name = ?, default_avg_time = ? WHERE service_id = ?',
        [name, default_avg_time, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to update service' });
            }
            res.json({ success: true });
        }
    );
});

app.delete('/api/services/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    
    db.db.run(
        'UPDATE services SET is_active = 0 WHERE service_id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete service' });
            }
            res.json({ success: true });
        }
    );
});

// Services
app.get('/api/services', (req, res) => {
    db.db.all(
        `SELECT s.*,
            COALESCE(
                (SELECT ROUND(AVG((julianday(st.completed_at) - julianday(st.started_at)) * 24 * 60))
                 FROM service_transactions st
                 JOIN tickets t ON st.ticket_id = t.ticket_id
                 WHERE t.service_id = s.service_id AND st.completed_at IS NOT NULL
                 ORDER BY st.completed_at DESC
                 LIMIT 20),
                s.default_avg_time
            ) as avg_time
         FROM services s WHERE s.is_active = 1`,
        (err, services) => {
            if (err) return res.status(500).json({ error: 'Failed to get services' });
            res.json(services);
        }
    );
});

// Counters
app.get('/api/counters', (req, res) => {
    db.getAllCounters((err, counters) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to get counters' });
        }
        res.json(counters);
    });
});

app.post('/api/counters', requireRole('admin'), (req, res) => {
    const { name, service_id, location } = req.body;
    
    if (!name || !service_id) {
        return res.status(400).json({ error: 'Name and service are required' });
    }
    
    db.db.run(
        'INSERT INTO counters (name, service_id, location) VALUES (?, ?, ?)',
        [name, service_id, location || null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to create counter' });
            }
            res.json({ success: true, counterId: this.lastID });
        }
    );
});

app.put('/api/counters/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { name, service_id, location, is_active } = req.body;
    
    db.db.run(
        'UPDATE counters SET name = ?, service_id = ?, location = ?, is_active = ? WHERE counter_id = ?',
        [name, service_id, location || null, is_active !== undefined ? is_active : 1, id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to update counter' });
            }
            res.json({ success: true });
        }
    );
});

app.delete('/api/counters/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    
    db.db.run(
        'UPDATE counters SET is_active = 0 WHERE counter_id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete counter' });
            }
            res.json({ success: true });
        }
    );
});

// Users
app.get('/api/roles', requireRole('admin'), (req, res) => {
    db.db.all(
        `SELECT role_id, role_name FROM roles ORDER BY role_id`,
        (err, roles) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to get roles' });
            }
            res.json(roles);
        }
    );
});

app.get('/api/users', requireRole('admin'), (req, res) => {
    db.db.all(
        `SELECT u.user_id, u.username, r.role_name, r.role_id, u.counter_id, c.name as counter_name
         FROM users u
         JOIN roles r ON u.role_id = r.role_id
         LEFT JOIN counters c ON u.counter_id = c.counter_id
         ORDER BY u.user_id`,
        (err, users) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to get users' });
            }
            res.json(users);
        }
    );
});

app.post('/api/users', requireRole('admin'), (req, res) => {
    const { username, password, role_id, counter_id } = req.body;
    
    if (!username || !password || !role_id) {
        return res.status(400).json({ error: 'Username, password, and role are required' });
    }
    
    const bcrypt = require('bcrypt');
    const password_hash = bcrypt.hashSync(password, 10);
    
    db.db.run(
        'INSERT INTO users (username, password_hash, role_id, counter_id) VALUES (?, ?, ?, ?)',
        [username, password_hash, role_id, counter_id || null],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: 'Failed to create user' });
            }
            res.json({ success: true, userId: this.lastID });
        }
    );
});

app.put('/api/users/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    const { username, password, role_id, counter_id } = req.body;
    
    // Build update query dynamically
    let updates = [];
    let params = [];
    
    if (username) {
        updates.push('username = ?');
        params.push(username);
    }
    
    if (password) {
        const bcrypt = require('bcrypt');
        const password_hash = bcrypt.hashSync(password, 10);
        updates.push('password_hash = ?');
        params.push(password_hash);
    }
    
    if (role_id) {
        updates.push('role_id = ?');
        params.push(role_id);
    }
    
    if (counter_id !== undefined) {
        updates.push('counter_id = ?');
        params.push(counter_id || null);
    }
    
    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    
    db.db.run(
        `UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`,
        params,
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username already exists' });
                }
                return res.status(500).json({ error: 'Failed to update user' });
            }
            res.json({ success: true });
        }
    );
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
    const { id } = req.params;
    
    // Prevent deleting the default admin user
    if (id === '1') {
        return res.status(403).json({ error: 'Cannot delete default admin user' });
    }
    
    db.db.run(
        'DELETE FROM users WHERE user_id = ?',
        [id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to delete user' });
            }
            res.json({ success: true });
        }
    );
});

// System settings
app.get('/api/settings', requireRole('admin'), (req, res) => {
    getSystemSettings((err, settings) => {
        if (err) return res.status(500).json({ error: 'Failed to get settings' });
        res.json(settings);
    });
});

app.get('/api/public-settings', (req, res) => {
    getSystemSettings((err, settings) => {
        if (err) return res.status(500).json({ error: 'Failed to get settings' });
        res.json({
            alert_ring_seconds: settings.alert_ring_seconds || '5'
        });
    });
});

app.put('/api/settings', requireRole('admin'), (req, res) => {
    const allowedSettings = {
        called_ticket_timeout_minutes: { min: 1, max: 60 },
        second_chance_limit: { min: 0, max: 5 },
        alert_ring_seconds: { min: 1, max: 15 },
        auto_refresh_seconds: { min: 5, max: 300 }
    };

    const updates = Object.entries(req.body).filter(([key]) => allowedSettings[key]);

    if (updates.length === 0) {
        return res.status(400).json({ error: 'No valid settings provided' });
    }

    let remaining = updates.length;
    let failed = false;

    updates.forEach(([key, value]) => {
        const rule = allowedSettings[key];
        const parsed = parseNumberSetting(value, null, rule.min, rule.max);

        if (parsed === null) {
            failed = true;
            return res.status(400).json({ error: `Invalid value for ${key}` });
        }

        db.db.run(
            `INSERT INTO system_settings (setting_key, setting_value)
             VALUES (?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
            [key, String(parsed)],
            (err) => {
                if (failed) return;
                if (err) {
                    failed = true;
                    return res.status(500).json({ error: 'Failed to update settings' });
                }

                remaining -= 1;
                if (remaining === 0) {
                    res.json({ success: true });
                }
            }
        );
    });
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/kiosk.html'));
});

app.get('/staff', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/staff.html'));
});

app.get('/staff/history', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/staff-history.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/manager', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/manager.html'));
});

app.get('/display', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/display.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    processCalledTicketTimeouts();
    setInterval(processCalledTicketTimeouts, 15000);
    console.log(`SmartQueue server running on port ${PORT}`);
    console.log(`Kiosk: http://localhost:${PORT}`);
    console.log(`Staff: http://localhost:${PORT}/staff`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`Manager: http://localhost:${PORT}/manager`);
    console.log(`Display: http://localhost:${PORT}/display`);
});
