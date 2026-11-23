# ShiftReady

Staff Selection UK's shift offer app. Consultants add compliant temps (singly or from a KISREC CSV export), temps opt in by text, and shift offers go out by text to active temps within a radius of the site. Temps accept from a private link after confirming their PPE; late responders can join standby.

**Setting it up for the first time? Follow [SETUP.md](SETUP.md).**

## What's in it

- **Consultant sign-in**: one login per consultant, email + password + authenticator app (two-step sign-in). Admin and Consultant roles.
- **Temps**: quick add, bulk CSV import with preview and checks, filters (area, distance from a postcode, job type, status, added by), bulk texts to opted-in temps only, hold/reactivate, GDPR delete (admin).
- **Shifts**: create with duties, pay, PPE, heads and radius; see how many temps it reaches before sending; live board (confirmed, standby, declined) that refreshes every 15 seconds; mark no-show (first person on standby is promoted and texted); cancel shift (booked temps are texted).
- **Temps' pages** (no login, private links in texts): opt in / opt out, view shift, tick PPE, accept or decline, standby, alerts.
- **Texts**: Twilio. Replies YES/START and STOP are handled automatically. Day-before reminders run every evening. Without Twilio keys the app runs in dry-run mode and logs texts without sending.
- **Client portal** (`/portal`): clients sign in with an emailed link, request shifts, see who's confirmed (name and induction flag only), mark attendance and rate temps. Office: Clients (sites, users, view as client, report, contacts export) and Client requests. See SETUP.md.
- **Ongoing workers & no messages**: a "No messages" switch on each worker stops every text, WhatsApp, email and shift offer to them (blocked messages are logged as "suppressed"). Put workers down as ongoing at a client (no end date needed) from their record or the client's page; their messages switch off automatically. Counts and CSV on Reports and each client's page. Needs `supabase/2026-11-16-ongoing-workers.sql`.
- **Import workers (admin, `/temps/import`)**: bring 1,000s of workers over from another system by CSV with nothing sent: names, contact, address, DOB, NI and bank (encrypted), right to work, old-system ID, and the client they work at. Column matching, preview, duplicate matching (mobile, NI, ID) and fill-in-blanks.
- **Pools (`/pools`)**: everyone booked on a shift at a site goes into that site's pool automatically (client name + site postcode), grouped by client. Open a site to see its workers down the left and Mon to Sun across: tap a day to turn it green for the days they want to work, tap a day heading to tick everyone green that day, then mass-text them for short-notice cover. Add or remove people by hand. Needs `supabase/2026-11-23b-pools.sql` (it also fills the pools from everyone already booked).
- **Team (admin)**: invite consultants by email, switch off access, set roles and alert mobiles, full audit trail.

## Tech

Next.js 14 (App Router) on Vercel · Supabase (Postgres, Auth, row level security) · Twilio SMS · postcodes.io for postcode lookups.

```
supabase/schema.sql        database tables, security rules, accept/no-show functions
supabase/first-admin.sql   makes your login an admin
src/app/(staff)/           consultant screens: temps, shifts, team
src/app/o/[token]          temp opt-in page
src/app/s/[token]          temp shift offer page
src/app/api/sms/inbound    Twilio reply webhook
src/app/api/cron/reminders day-before reminder job
src/lib/texts.ts           wording of every automatic text
src/app/portal/            client portal (sign-in, requests, attendance, ratings)
src/app/(staff)/clients    client accounts, sites, users, report
src/lib/clients.ts         office alerts, client emails, ratings
```

## Running locally

```
cp .env.example .env.local   # fill in Supabase keys; leave Twilio blank for dry-run
npm install
npm run dev
```
