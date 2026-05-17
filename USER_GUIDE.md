# SmartQueue User Guide

**Live URL:** https://smartqueue.fly.dev/

---

## Overview

SmartQueue is a digital queue management system with four pages:

| Page | URL | Who uses it |
|------|-----|-------------|
| Kiosk | `/` | Customers — get a ticket |
| Staff | `/staff` | Staff — serve customers |
| Admin | `/admin` | Admin — manage everything |
| Display | `/display` | TV screen — shows queue status |

---

## Logins

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `admin123` |
| Staff (Counter 1) | `counter1` | `password` |

---

## The Workflow (End to End)

```
Customer gets ticket (Kiosk)
        ↓
Staff calls ticket (Staff Dashboard)
        ↓
Customer comes to counter
        ↓
Staff starts serving (Staff Dashboard)
        ↓
Staff completes service (Staff Dashboard)
        ↓
Ticket closed ✅
```

---

## 1. Customer — Kiosk Page (`/`)

This is the self-service screen customers use to join the queue.

**Steps:**
1. Open https://smartqueue-lpyj.onrender.com/
2. You will see a list of available services (e.g. General Service, Customer Support)
3. Each service card shows which counter handles it (e.g. "📍 Served at: Counter 1")
4. Tap/click the service you need
5. Click **Get Ticket**
6. Your ticket number appears on screen

**On the ticket screen:**
- Your ticket number is shown in large text
- Your position in the queue updates in real time
- The status updates automatically every 5 seconds:
  - **Waiting to be called** — you are in the queue but staff have not called you yet
  - **Called, awaiting service** — go to the counter now
  - **Being Served** — service has started
  - **Completed** — service done, thank you
- To cancel your ticket, click **Cancel Ticket**
- The screen stays on your ticket until service is complete — do not close it

---

## 2. Staff Dashboard (`/staff`)

This is where staff members manage the queue at their counter.

**Login:**
1. Go to https://smartqueue.fly.dev/staff
2. Enter username `counter1` and password `password`
3. Click **Login**

**What you see after login:**
- Your counter name and assigned service shown at the top
- A metrics bar showing tickets waiting, served today, average wait time
- **Current Ticket** panel on the left — shows the ticket you are actively handling
- **Queue** panel on the right — all tickets for your service

**Serving a customer:**
1. When a customer is waiting, their ticket appears in the Queue panel
2. Click **Call** next to a ticket — this notifies the customer on the kiosk screen
3. The ticket moves to your **Current Ticket** panel with status "Called"
4. When the customer arrives at your counter, click **Start Serving**
5. When you finish, click **Complete Service**
6. The ticket is closed and the next one is ready

**Other actions:**
- **Call Next Customer** button — automatically calls the next waiting ticket
- **No Show** — if the customer doesn't come, mark them as no-show
- **View History** — shows your last 10 completed, no-show, and cancelled tickets
- **Take Break / Resume Work** — pauses your queue so no tickets are shown while you are away
- **Refresh** button — manually refreshes the queue list

> The queue also updates automatically via WebSocket when new tickets are created.

---

## 3. Admin Dashboard (`/admin`)

Full control over the system.

**Login:**
1. Go to https://smartqueue.fly.dev/admin
2. Enter username `admin` and password `admin123`
3. Click **Login**

### Dashboard Tab
- Overview cards: total tickets today, served tickets, average wait time, active counters
- Queue Activity table: breakdown of ticket statuses for today (Waiting to be called, Called awaiting service, Being served, Completed, No-Show)

### Queue Management Tab
- See all tickets across all services in real time
- Each row shows: ticket number, service, status, wait time, assigned counter
- Click the 👁️ **View** button to see full ticket details (all timestamps, total time, counter)

### Services Tab
- Lists all services with their average handling time
- **Add a service:** fill in the name and average time, click **Save Service**
- **Edit a service:** click ✏️, update the fields, click **Update Service**
- **Delete a service:** click 🗑️

### Counters Tab
- Lists all counters and which service each one handles
- **Add a counter:** fill in name, select the service it handles, add location (optional), click **Save Counter**
- **Edit a counter:** click ✏️
- **Delete a counter:** click 🗑️

> Each counter is assigned to one specific service. Multiple counters can handle the same service.

### Users Tab
- Lists all staff accounts
- **Add a user:** fill in username, password, select role (staff/admin), assign a counter, click **Create User**
- **Edit a user:** click ✏️ — password is optional when editing (leave blank to keep current)
- **Delete a user:** click 🗑️ (the default admin account cannot be deleted)

> Staff users must be assigned to a counter. They will only see tickets for their counter's service.

### Analytics Tab
- All-time stats: total tickets, completion rate, average service time, no-show rate

---

## 4. Display Screen (`/display`)

Meant to be shown on a TV or monitor in the waiting area.

- Shows currently called/serving tickets in real time
- Shows counter-to-service mapping so customers know where to go
- Updates automatically via WebSocket — no refresh needed

---

## Tips

- The system uses **Nairobi time (EAT, UTC+3)** for all timestamps
- Tickets are sorted newest first in the staff queue
- Admin users can see and manage all tickets across all counters
- Staff users only see tickets for their assigned counter's service
- The app auto-scales on Fly.io — first load after inactivity may take a few seconds to wake up
