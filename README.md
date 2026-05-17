# SmartQueue - Digital Queue Management System

A comprehensive digital queue management system built with HTML, CSS, JavaScript, Express.js, and SQLite. SmartQueue provides real-time queue management with moving average wait time estimation, multi-counter support, and comprehensive analytics.

## Features

### Core Functionality
- **Digital Ticket Generation**: Customer kiosk interface for service selection and ticket generation
- **Real-time Queue Management**: Staff dashboard for calling, serving, and managing tickets
- **Moving Average Estimation**: Intelligent wait time calculation based on last 20 completed transactions
- **Multi-Counter Support**: Synchronized operations across multiple service counters
- **No-Show Management**: Automated handling of missed appointments
- **Second-Chance Timeout**: Called tickets can return to the front once, then cancel if missed again
- **Shareable Tickets**: Customer tickets include a copyable link, QR code, and print-friendly view
- **Manager Report Export**: Managers can request focused reports and export CSV or print/save as PDF
- **Close-Day Controls**: Admins can close active tickets at the end of the day
- **Ticket Transfer**: Admins can transfer active tickets between services/counters
- **Sound Alerts**: Customer ticket pages ring on status changes and public display can ring on new called tickets
- **Offline Warning**: Interfaces show a reconnecting warning when live updates drop
- **Real-time Updates**: WebSocket-based live updates across all interfaces

### User Interfaces
1. **Customer Kiosk** (`/`) - Touch-friendly interface for ticket generation
2. **Staff Dashboard** (`/staff`) - Queue management and ticket processing
3. **Manager Reports** (`/manager`) - Supervisor report requests for queues, counters, services, and no-shows
4. **Admin Panel** (`/admin`) - System configuration and analytics
5. **Public Display** (`/display`) - Real-time queue status for waiting areas

### Technical Features
- **Responsive Design**: Works on tablets, desktops, and mobile devices
- **Real-time Synchronization**: WebSocket connections for instant updates
- **Role-based Access Control**: Admin, staff, and customer access levels
- **Performance Analytics**: Comprehensive reporting and metrics
- **Audit Logging**: Complete transaction history and system logs

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **Real-time**: WebSockets
- **Authentication**: Session-based with bcrypt password hashing

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm (Node Package Manager)

### Setup Instructions

1. **Clone or download the project**
   ```bash
   cd smart-queue
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

4. **Access the application**
   - Customer Kiosk: http://localhost:3000
   - Staff Dashboard: http://localhost:3000/staff
   - Manager Dashboard: http://localhost:3000/manager
   - Admin Panel: http://localhost:3000/admin
   - Public Display: http://localhost:3000/display

## Default Login Credentials

### Admin Access
- **Username**: `admin`
- **Password**: `admin123`

### Staff Access
- Use the same admin credentials for initial setup
- Additional staff users can be created through the admin panel

### Manager Access
- **Username**: `manager`
- **Password**: `manager123`

## Usage Guide

### Customer Kiosk Interface
1. **Select Service**: Choose from available services
2. **Generate Ticket**: Click "Get Ticket" to receive queue number
3. **View Details**: See position in queue and estimated wait time
4. **Print Ticket**: Optional physical ticket printing

### Staff Dashboard
1. **Login**: Use staff credentials to access dashboard
2. **Call Next**: Call the next customer in queue
3. **Serve Customer**: Mark ticket as being served
4. **Complete Service**: Mark service as completed
5. **Handle No-Shows**: Mark customers who don't respond as no-show

### Admin Panel
1. **Dashboard**: View system overview and statistics
2. **Queue Management**: Monitor all active tickets across services
3. **Services**: Configure available services and average times
4. **Counters**: Manage service counters and assignments
5. **Settings**: System configuration and preferences

### Public Display
- **Real-time Status**: Shows currently serving tickets
- **Queue Overview**: Displays next customers in line
- **Statistics**: Live metrics and wait times
- **Auto-refresh**: Updates automatically every few seconds

## Database Schema

### Core Tables
- **services**: Available services and default processing times
- **counters**: Service counter configuration and assignments
- **tickets**: Customer tickets and status tracking
- **service_transactions**: Processing history and timing data
- **users**: System users and authentication
- **roles**: User roles and permissions
- **notifications**: System notifications and alerts

### Key Relationships
- Services have multiple counters
- Tickets belong to services
- Transactions link tickets to counters
- Users have roles with specific permissions

## Configuration

### Environment Variables
Create a `.env` file for production configuration:
```
PORT=3000
NODE_ENV=production
SESSION_SECRET=your-secret-key-here
DB_PATH=./database/smartqueue.db
```

### System Settings
- **Update Interval**: Real-time refresh rate (default: 2 seconds)
- **Moving Average Window**: Number of transactions for wait time calculation (default: 20)
- **No-Show Timeout**: Minutes before marking ticket as no-show (default: 10)
- **Session Timeout**: User session duration (default: 24 hours)

## API Endpoints

### Public Endpoints
- `GET /api/services` - List available services
- `POST /api/tickets` - Create new ticket
- `GET /api/tickets/:id` - Load a single ticket for shared ticket links
- `PUT /api/tickets/:id/cancel` - Cancel a customer ticket
- `GET /api/queue/:serviceId` - Get queue status

### Authenticated Endpoints
- `POST /api/login` - User authentication
- `POST /api/logout` - User logout
- `PUT /api/tickets/:id/status` - Update ticket status
- `PUT /api/tickets/:id/transfer` - Transfer active ticket to another service/counter
- `POST /api/admin/close-day` - Close active day tickets
- `GET /api/counters` - List service counters

## Development

### Project Structure
```
smart-queue/
├── public/                 # Frontend assets
│   ├── css/               # Stylesheets
│   ├── js/                # JavaScript files
│   └── *.html             # HTML pages
├── server/                # Backend code
│   ├── app.js             # Main server file
│   ├── database.js        # Database operations
│   ├── routes/            # API routes
│   └── middleware/        # Custom middleware
├── database/              # SQLite database
└── package.json           # Dependencies and scripts
```

### Adding New Features
1. **Frontend**: Add HTML, CSS, and JavaScript in `public/` directory
2. **Backend**: Add routes in `server/routes/` and update `app.js`
3. **Database**: Modify schema in `server/database.js`
4. **Styling**: Use existing CSS variables and classes for consistency

### Customization
- **Branding**: Update colors and logos in CSS files
- **Services**: Configure available services through admin panel
- **Workflow**: Modify ticket lifecycle in business logic
- **Notifications**: Extend notification system for SMS/email

## Performance Considerations

### Optimization Features
- **Efficient Polling**: Smart refresh intervals based on activity
- **Connection Pooling**: Optimized database connections
- **Caching**: Session and data caching for improved response times
- **Compression**: Gzip compression for static assets

### Scalability
- **Concurrent Users**: Supports 200+ concurrent active tickets
- **Multiple Counters**: Unlimited service counters per service type
- **Real-time Updates**: WebSocket connections with automatic reconnection
- **Database Performance**: Indexed queries and optimized schema

## Troubleshooting

### Common Issues
1. **Port Already in Use**: Change PORT in environment variables
2. **Database Locked**: Restart server to release SQLite locks
3. **WebSocket Connection Failed**: Check firewall and proxy settings
4. **Login Issues**: Verify default credentials and database initialization

### Logs and Debugging
- Server logs: Check console output for errors
- Browser console: Check for JavaScript errors
- Network tab: Monitor API requests and responses
- Database: Use SQLite browser tools for direct database access

## Security Features

- **Password Hashing**: bcrypt for secure password storage
- **Session Management**: Secure session handling with timeouts
- **Input Validation**: Server-side validation for all inputs
- **SQL Injection Protection**: Parameterized queries
- **XSS Prevention**: Content sanitization and CSP headers

## License

This project is developed for educational purposes as part of the SCS3206 Second Year Project. All rights reserved.

## Support

For technical support or questions:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Verify database connectivity and initialization
4. Ensure all dependencies are properly installed

## Future Enhancements

- Mobile application development
- SMS/Email notification integration
- Advanced analytics and reporting
- Multi-language support
- Integration with external systems
- Biometric identification support
