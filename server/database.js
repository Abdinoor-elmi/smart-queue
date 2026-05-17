const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

class Database {
    constructor() {
        const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../database/smartqueue.db');
        console.log('Database path:', dbPath);
        
        // Ensure directory exists
        const dbDir = path.dirname(dbPath);
        const fs = require('fs');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.db = new sqlite3.Database(dbPath);
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // Roles table
            this.db.run(`CREATE TABLE IF NOT EXISTS roles (
                role_id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_name TEXT UNIQUE NOT NULL,
                permissions TEXT NOT NULL
            )`);

            // Users table
            this.db.run(`CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role_id INTEGER NOT NULL,
                counter_id INTEGER,
                FOREIGN KEY (role_id) REFERENCES roles (role_id),
                FOREIGN KEY (counter_id) REFERENCES counters (counter_id)
            )`, () => {
                // Migration: Add counter_id column if it doesn't exist
                this.db.all("PRAGMA table_info(users)", (err, columns) => {
                    if (err) {
                        console.error('Failed to check users table info:', err);
                        return;
                    }
                    const hasCounterId = columns.some(col => col.name === 'counter_id');
                    if (!hasCounterId) {
                        console.log('Adding counter_id column to users table...');
                        this.db.run('ALTER TABLE users ADD COLUMN counter_id INTEGER', (err) => {
                            if (err) {
                                console.error('Failed to add counter_id column to users:', err);
                            } else {
                                console.log('counter_id column added to users successfully');
                            }
                        });
                    }
                });
            });

            // Services table
            this.db.run(`CREATE TABLE IF NOT EXISTS services (
                service_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                default_avg_time INTEGER NOT NULL,
                is_active BOOLEAN DEFAULT 1
            )`);

            // Counters table
            this.db.run(`CREATE TABLE IF NOT EXISTS counters (
                counter_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                service_id INTEGER NOT NULL,
                location TEXT,
                is_active BOOLEAN DEFAULT 1,
                FOREIGN KEY (service_id) REFERENCES services (service_id)
            )`);

            // Tickets table
            this.db.run(`CREATE TABLE IF NOT EXISTS tickets (
                ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_number TEXT NOT NULL,
                service_id INTEGER NOT NULL,
                counter_id INTEGER,
                status TEXT DEFAULT 'waiting',
                missed_calls INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                called_at DATETIME,
                served_at DATETIME,
                completed_at DATETIME,
                FOREIGN KEY (service_id) REFERENCES services (service_id),
                FOREIGN KEY (counter_id) REFERENCES counters (counter_id)
            )`, () => {
                // Migration: Add counter_id column if it doesn't exist
                this.db.all("PRAGMA table_info(tickets)", (err, columns) => {
                    if (err) {
                        console.error('Failed to check table info:', err);
                        return;
                    }
                    const hasCounterId = columns.some(col => col.name === 'counter_id');
                    const hasMissedCalls = columns.some(col => col.name === 'missed_calls');
                    if (!hasCounterId) {
                        console.log('Adding counter_id column to tickets table...');
                        this.db.run('ALTER TABLE tickets ADD COLUMN counter_id INTEGER', (err) => {
                            if (err) {
                                console.error('Failed to add counter_id column:', err);
                            } else {
                                console.log('counter_id column added successfully');
                            }
                        });
                    }
                    if (!hasMissedCalls) {
                        console.log('Adding missed_calls column to tickets table...');
                        this.db.run('ALTER TABLE tickets ADD COLUMN missed_calls INTEGER DEFAULT 0', (err) => {
                            if (err) {
                                console.error('Failed to add missed_calls column:', err);
                            } else {
                                console.log('missed_calls column added successfully');
                            }
                        });
                    }
                });
            });

            // Service Transactions table
            this.db.run(`CREATE TABLE IF NOT EXISTS service_transactions (
                transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                counter_id INTEGER NOT NULL,
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (ticket_id) REFERENCES tickets (ticket_id),
                FOREIGN KEY (counter_id) REFERENCES counters (counter_id)
            )`);

            // Notifications table
            this.db.run(`CREATE TABLE IF NOT EXISTS notifications (
                notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                channel TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                sent_at DATETIME,
                FOREIGN KEY (ticket_id) REFERENCES tickets (ticket_id)
            )`);

            // System Settings table
            this.db.run(`CREATE TABLE IF NOT EXISTS system_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL,
                description TEXT
            )`);

            // Insert default data
            this.insertDefaultData();
        });
    }

    insertDefaultData() {
        this.db.run(
            `INSERT OR IGNORE INTO roles (role_name, permissions) VALUES 
                ('admin', 'all'),
                ('staff', 'tickets,counters'),
                ('viewer', 'view'),
                ('manager', 'view,analytics,queue')`
        );

        this.db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err || row.count > 0) return; // Data already exists
            
            // Insert default admin user
            const adminPassword = bcrypt.hashSync('admin123', 10);
            this.db.run(`INSERT INTO users (username, password_hash, role_id) VALUES 
                ('admin', ?, 1)`, [adminPassword]);
        });

        this.db.get(`SELECT user_id FROM users WHERE username = 'manager'`, (err, row) => {
            if (err || row) return;

            this.db.get(`SELECT role_id FROM roles WHERE role_name = 'manager'`, (err, role) => {
                if (err || !role) return;

                const managerPassword = bcrypt.hashSync('manager123', 10);
                this.db.run(
                    `INSERT INTO users (username, password_hash, role_id) VALUES (?, ?, ?)`,
                    ['manager', managerPassword, role.role_id]
                );
            });
        });

        this.db.get('SELECT COUNT(*) as count FROM services', (err, row) => {
            if (err || row.count > 0) return; // Data already exists
            
            // Insert default services
            this.db.run(`INSERT INTO services (name, default_avg_time) VALUES 
                ('General Service', 5),
                ('Customer Support', 8),
                ('Technical Support', 12)`);
        });

        this.db.get('SELECT COUNT(*) as count FROM counters', (err, row) => {
            if (err || row.count > 0) return; // Data already exists
            
            // Insert default counters
            this.db.run(`INSERT INTO counters (name, service_id, location) VALUES 
                ('Counter 1', 1, 'Ground Floor'),
                ('Counter 2', 2, 'Ground Floor'),
                ('Counter 3', 3, 'First Floor')`);
        });

        const defaultSettings = [
            ['called_ticket_timeout_minutes', '2', 'Minutes a called ticket can wait before it is treated as missed'],
            ['second_chance_limit', '1', 'How many missed calls are allowed before cancellation'],
            ['alert_ring_seconds', '5', 'Seconds the customer ticket page rings when status changes'],
            ['auto_refresh_seconds', '30', 'Fallback dashboard refresh interval in seconds']
        ];

        defaultSettings.forEach(([key, value, description]) => {
            this.db.run(
                `INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?)`,
                [key, value, description]
            );
        });
    }

    // Ticket operations
    createTicket(serviceId, callback) {
        this.generateTicketNumber(serviceId, (err, ticketNumber) => {
            if (err) {
                if (callback) callback(err);
                return;
            }

            this.db.run(
                `INSERT INTO tickets (ticket_number, service_id) VALUES (?, ?)`,
                [ticketNumber, serviceId],
                function(err) {
                    if (callback) callback(err, this.lastID, ticketNumber);
                }
            );
        });
    }

    generateTicketNumber(serviceId, callback) {
        this.db.get(
            `SELECT name FROM services WHERE service_id = ?`,
            [serviceId],
            (err, service) => {
                if (err) {
                    callback(err);
                    return;
                }

                const prefix = this.getServiceAbbreviation(service ? service.name : 'Service');

                this.db.get(
                    `SELECT COUNT(*) as count
                     FROM tickets
                     WHERE service_id = ?
                       AND date(created_at, '+3 hours') = date('now', '+3 hours')`,
                    [serviceId],
                    (err, row) => {
                        if (err) {
                            callback(err);
                            return;
                        }

                        const sequence = String((row ? row.count : 0) + 1).padStart(3, '0');
                        callback(null, `${prefix}-${sequence}`);
                    }
                );
            }
        );
    }

    getServiceAbbreviation(serviceName) {
        const words = String(serviceName || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        if (words.length >= 2) {
            return `${words[0][0]}${words[1][0]}`.toUpperCase();
        }

        const compactName = words[0] || 'S';
        return compactName.slice(0, 2).toUpperCase().padEnd(2, 'X');
    }

    getQueueStatus(serviceId, callback) {
        this.db.all(
            `SELECT t.*, s.name as service_name 
             FROM tickets t 
             JOIN services s ON t.service_id = s.service_id 
             WHERE t.service_id = ? AND t.status IN ('waiting', 'called', 'serving') 
             ORDER BY CASE WHEN t.missed_calls > 0 AND t.status = 'waiting' THEN 0 ELSE 1 END,
                      t.created_at`,
            [serviceId],
            callback
        );
    }

    updateTicketStatus(ticketId, status, counterId, callback) {
        const parsedCounterId = Number.parseInt(counterId, 10);
        const validCounterId = Number.isInteger(parsedCounterId) ? parsedCounterId : null;
        const updateField = status === 'called' ? 'called_at' :
                           status === 'serving' ? 'served_at' :
                           ['completed', 'no-show', 'cancelled'].includes(status) ? 'completed_at' : null;
        
        let query = `UPDATE tickets SET status = ?`;
        let params = [status];
        
        if (updateField) {
            query += `, ${updateField} = CURRENT_TIMESTAMP`;
        }
        
        if (validCounterId && (status === 'called' || status === 'serving')) {
            query += `, counter_id = ?`;
            params.push(validCounterId);
        }

        if (['completed', 'no-show', 'cancelled'].includes(status)) {
            query += `, counter_id = NULL`;
        }
        
        query += ` WHERE ticket_id = ?`;
        params.push(ticketId);
        
        this.db.run(query, params, callback);
    }

    createServiceTransaction(ticketId, counterId, callback) {
        this.db.run(
            `INSERT INTO service_transactions (ticket_id, counter_id) VALUES (?, ?)`,
            [ticketId, counterId],
            callback
        );
    }

    completeServiceTransaction(ticketId, callback) {
        this.db.run(
            `UPDATE service_transactions 
             SET completed_at = CURRENT_TIMESTAMP 
             WHERE ticket_id = ? AND completed_at IS NULL`,
            [ticketId],
            callback
        );
    }

    getMovingAverage(serviceId, callback) {
        this.db.get(
            `SELECT AVG(
                (julianday(completed_at) - julianday(started_at)) * 24 * 60
             ) as avg_time
             FROM service_transactions st
             JOIN tickets t ON st.ticket_id = t.ticket_id
             WHERE t.service_id = ? AND st.completed_at IS NOT NULL
             ORDER BY st.completed_at DESC
             LIMIT 20`,
            [serviceId],
            (err, row) => {
                if (err || !row || !row.avg_time) {
                    // Fallback to default average time
                    this.db.get(
                        `SELECT default_avg_time FROM services WHERE service_id = ?`,
                        [serviceId],
                        (err, service) => {
                            callback(err, service ? service.default_avg_time : 5);
                        }
                    );
                } else {
                    callback(null, Math.round(row.avg_time));
                }
            }
        );
    }

    getAllServices(callback) {
        this.db.all(`SELECT * FROM services WHERE is_active = 1`, callback);
    }

    getAllCounters(callback) {
        this.db.all(
            `SELECT c.*, s.name as service_name 
             FROM counters c 
             JOIN services s ON c.service_id = s.service_id 
             WHERE c.is_active = 1`,
            callback
        );
    }

    createServiceTransaction(ticketId, counterId, callback) {
        this.db.run(
            `INSERT INTO service_transactions (ticket_id, counter_id) VALUES (?, ?)`,
            [ticketId, counterId],
            callback
        );
    }

    completeServiceTransaction(ticketId, callback) {
        this.db.run(
            `UPDATE service_transactions 
             SET completed_at = CURRENT_TIMESTAMP 
             WHERE ticket_id = ? AND completed_at IS NULL`,
            [ticketId],
            callback
        );
    }

    authenticateUser(username, password, callback) {
        this.db.get(
            `SELECT u.*, r.role_name, r.permissions, c.name as counter_name, c.service_id
             FROM users u 
             JOIN roles r ON u.role_id = r.role_id 
             LEFT JOIN counters c ON u.counter_id = c.counter_id
             WHERE u.username = ?`,
            [username],
            (err, user) => {
                if (err || !user) {
                    return callback(err, null);
                }
                
                bcrypt.compare(password, user.password_hash, (err, match) => {
                    if (err || !match) {
                        return callback(err, null);
                    }
                    callback(null, user);
                });
            }
        );
    }
}

module.exports = Database;
