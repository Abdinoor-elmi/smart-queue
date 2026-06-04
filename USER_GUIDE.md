# SmartQueue User Guide

**Live URL:** https://smartqueue-8fcf.onrender.com/

---

## Overview

SmartQueue is a digital queue management system for issuing customer tickets, calling customers to counters, showing public queue status, and producing administrative and manager reports.

| Page | URL | Who uses it |
|------|-----|-------------|
| Kiosk | `/` | Customers get and track tickets |
| Staff Dashboard | `/staff` | Staff call, serve, and complete tickets |
| Staff History | `/staff/history` | Staff review handled tickets |
| Admin Dashboard | `/admin` | Admins manage services, counters, users, queue records, settings, transfers, and close-day actions |
| Manager Reports | `/manager` | Managers generate focused reports |
| Display Screen | `/display` | Waiting-area TV or monitor shows live queue status |

---

## Logins

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Manager | `manager` | `manager123` |
| Staff example | `counter1` | `password` |

The app automatically creates the default admin and manager accounts when the database is initialized. Staff accounts such as `counter1` work only if they already exist in the provided database, or after an admin creates them in the Admin Dashboard and assigns them to a counter.

---

## The Workflow

```text
Customer gets ticket from Kiosk
        |
Staff calls the ticket
        |
Customer goes to the counter
        |
Staff starts serving
        |
Staff completes service
        |
Ticket is closed
```

If a called customer does not arrive, the ticket can receive a second chance based on the system settings. After the allowed missed calls are used, the ticket becomes no-show.

---

## 1. Customer Kiosk (`/`)

This is the self-service screen customers use to join the queue.

**Steps:**
1. Open https://smartqueue-8fcf.onrender.com/
2. Choose an available service, such as General Service or Customer Support.
3. Check the service card to see which counter handles that service.
4. Click **Get Ticket**.
5. Your ticket number appears on screen.

**On the ticket screen:**
- Your ticket number is shown in large text.
- Your queue position and estimated wait time update automatically.
- The ticket status can be:
  - **Waiting to be called** - you are in the queue.
  - **Called, awaiting service** - go to the counter.
  - **Being Served** - service has started.
  - **Completed** - service is finished.
  - **Cancelled** - the ticket was cancelled.
  - **No Show** - the ticket was missed after the allowed chances.
- You can print the ticket.
- You can copy the ticket link or use the QR code to reopen the ticket status.
- You can click **Cancel Ticket** while the ticket is still active.

Keep the ticket screen open if you want to receive live status updates and sound alerts.

---

## 2. Staff Dashboard (`/staff`)

This page is where staff members manage tickets for their assigned counter.

**Login:**
1. Go to https://smartqueue-8fcf.onrender.com/staff
2. Enter your staff username and password.
3. Click **Login**.

If you are using the sample database, try `counter1` / `password`. If that account does not work, log in as admin and create a staff user first.

**What staff see after login:**
- Assigned counter and service at the top.
- Waiting count, served-today count, and average wait time.
- **Current Ticket** panel for the active called or serving ticket.
- **Queue Status** panel for active tickets in the assigned service.
- **Quick Actions** for history, break mode, and auto-call mode.
- Today's performance metrics.

**Serving a customer:**
1. Click **Call** on a waiting ticket, or click **Call Next Customer**.
2. The customer sees the ticket status change to called.
3. When the customer arrives, click **Start Serving**.
4. When service is done, click **Complete Service**.
5. If auto-call is on, the next waiting ticket can be called automatically after completion.

**Other staff actions:**
- **Recall** - call the same ticket again.
- **No Show** - mark a called ticket as no-show.
- **View History** - show recent completed, no-show, and cancelled tickets.
- **Take Break / Resume Work** - hide queue work while staff are away.
- **Auto Call On / Auto Call Paused** - control whether the next ticket is called automatically after completing service.
- **Refresh** - manually reload queue data.

Tickets are ordered so second-chance waiting tickets appear first, followed by older waiting tickets before newer ones.

---

## 3. Staff History (`/staff/history`)

This page lets staff review recently handled tickets.

**Use it to:**
- View completed, no-show, and cancelled tickets.
- Filter history records.
- Export staff history as CSV.

Staff can open it directly at https://smartqueue-8fcf.onrender.com/staff/history or from **View History** in the Staff Dashboard.

---

## 4. Admin Dashboard (`/admin`)

The Admin Dashboard gives full control over the system.

**Login:**
1. Go to https://smartqueue-8fcf.onrender.com/admin
2. Enter username `admin` and password `admin123`.
3. Click **Login**.

### Dashboard Tab
- View total tickets, served tickets, average wait time, and active counters.
- See today's queue activity by status.

### Queue Management Tab
- See tickets across services.
- Open full ticket details.
- Transfer or assign active tickets to another service or counter.

### Services Tab
- Add, edit, and deactivate services.
- Set default average handling time.

### Counters Tab
- Add, edit, and deactivate counters.
- Assign each counter to one service.
- Add an optional counter location.

### Users Tab
- Add users with roles such as admin, staff, manager, or viewer.
- Assign staff users to counters.
- Edit users; passwords are optional when editing.
- Delete users, except the default admin account.

### Reports / Analytics
- Review service and queue performance information.
- Check status breakdowns and operational summaries.

### Settings Tab
- Configure called-ticket timeout.
- Configure second-chance limit.
- Configure alert ring duration.
- Configure fallback auto-refresh interval.

### Close Day
- Close active waiting, called, and serving tickets as no-show at the end of the day.

---

## 5. Manager Reports (`/manager`)

Managers use this page to generate focused reports without full admin control.

**Login:**
1. Go to https://smartqueue-8fcf.onrender.com/manager
2. Enter username `manager` and password `manager123`.
3. Click **Login**.

**Available reports:**
- Summary
- Active Queue
- Service Performance
- Counter Activity
- Peak Hours
- No-Show Report
- Ticket Details

**Report tools:**
- Filter by date range.
- Filter by service.
- Filter by counter.
- Export generated reports as CSV.
- Use **Export PDF** to open the browser print dialog and save as PDF.

---

## 6. Display Screen (`/display`)

This page is meant for a TV or monitor in the waiting area.

Open https://smartqueue-8fcf.onrender.com/display

The display shows:
- Waiting, called, and serving counts.
- Active tickets grouped by counter.
- Ticket status labels.
- Current time and last-updated time.

The display updates automatically through WebSocket messages and periodic data refresh.

---

## Tips

- The system uses Nairobi time (EAT, UTC+3) for ticket numbering and display.
- Staff users only see tickets for their assigned counter's service.
- Admin users can manage all system records.
- Manager users can generate reports but do not manage system setup.
- If the hosted app has been inactive, the first load may take a few seconds while the service wakes up.
