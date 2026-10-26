# ShiftReady

Staff Selection UK's shift offer app. Consultants add compliant temps (singly or from a KISREC CSV export), temps opt in by text, and shift offers go out by text to active temps within a radius of the site. Temps accept from a private link after confirming their PPE; late responders can join standby.

**Setting it up for the first time? Follow [SETUP.md](SETUP.md).**

## What's in it

- **Consultant sign-in**: one login per consultant, email + password + authenticator app (two-step sign-in). Admin and Consultant roles.
- **Temps**: quick add, bulk CSV import with preview and checks, filters (area, distance from a postcode, job type, status, added by), bulk texts to opted-in temps only, hold/reactivate, GDPR delete (admin).
- **Shifts**: create with duties, pay, PPE, heads and radius; see how many temps it reaches before sending; live board (confirmed, standby, declined) that refreshes every 15 seconds; mark no-show (first person on standby is promoted and texted); cancel shift (booked temps are texted).
- **Temps' pages** (no login, private links in texts): opt in / opt out, view shift, tick PPE, accept or decline, standby, alerts.
- **Texts**: Twilio. Replies YES/START and STOP are handled automatically. Day-before reminders run every evening. Without Twilio keys the app runs in dry-run mode and logs texts without sending.
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
```

## Running locally

```
cp .env.example .env.local   # fill in Supabase keys; leave Twilio blank for dry-run
npm install
npm run dev
```
