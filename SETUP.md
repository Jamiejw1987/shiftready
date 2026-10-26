# Setting up ShiftReady

About an hour, start to finish. You don't need to write any code. Do the steps in order.

You'll need: your Supabase, Vercel and GitHub accounts, and (for real texts) a Twilio account.

---

## 1. Create the database (Supabase)

1. In Supabase, click **New project**.
   - Name: `shiftready`
   - Region: **London (eu-west-2)**. Keeps temps' data in the UK.
   - Set a strong database password and save it in your password manager.
2. When it's ready, open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this repository, copy everything, paste it in, and press **Run**. You should see "Success".

## 2. Lock down sign-ups and set the email links

In Supabase:

1. **Authentication → Sign In / Providers → Email**: leave Email enabled, and **turn OFF "Allow new users to sign up"**. Only admins can add consultants, by invite.
2. **Authentication → URL Configuration**:
   - Site URL: your app address, e.g. `https://shiftready.staffselectionuk.com` (use the Vercel address from step 4 for now, then update it).
   - Redirect URLs: add the same address followed by `/**`.
3. **Authentication → Multi-Factor**: make sure **TOTP (authenticator app)** is enabled.
4. Optional: **Authentication → Emails → Templates**. ShiftReady works with Supabase's default invite and reset emails, so you can skip this. If you prefer, you can reword them and use these links:
   - **Invite user**: replace the link in the message with
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
     A simple body: `You've been invited to ShiftReady by Staff Selection UK. <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Set your password</a>`
   - **Reset password**: replace the link with
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
5. Optional but recommended: **Authentication → Emails → SMTP Settings** to send from your own domain (e.g. through Microsoft 365). Supabase's built-in email is rate-limited and fine only for testing.

## 3. Make yourself the first admin

1. **Authentication → Users → Add user → Create new user**. Enter your work email and a strong password, tick **Auto confirm user**.
2. **SQL Editor → New query**: open `supabase/first-admin.sql`, change the name and email if needed, paste it in and **Run**.

## 4. Put the app online (Vercel)

1. In Vercel, **Add New → Project**, choose the GitHub repository `shiftready`, and click **Import**.
2. Before deploying, open **Environment Variables** and add each of these (values from Supabase → **Project Settings → API**):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
   | `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (secret: never share it) |
   | `APP_URL` | your app address, no slash at the end |
   | `CRON_SECRET` | any long random string (e.g. from a password generator) |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | leave out for now (step 6) |

3. Click **Deploy**. When it finishes you'll get an address like `shiftready-xyz.vercel.app`.
4. Your own address (recommended): **Settings → Domains → Add** `shiftready.staffselectionuk.com`, then add the DNS record Vercel shows you wherever your domain is managed. Update `APP_URL` in Vercel and the Site URL in Supabase (step 2) to match, then **Redeploy**.

## 5. Sign in and test (dry run)

With no Twilio keys, texts are recorded but not sent. That's safe for testing.

1. Open the app and sign in. On first sign-in, scan the QR code with an authenticator app (Microsoft Authenticator or Google Authenticator) and enter the code.
2. **Temps**: add yourself as a temp with your own mobile, ticked as compliant.
3. To see what the temp sees, open Supabase → **Table Editor → temps**, copy your `optin_token`, and open `APP_URL/o/<token>`. Press **Yes, send me shifts**. You're now Active.
4. **Shifts**: create a shift near your postcode and send it. On the board, you'll be listed under "Who it went to".
5. In **Table Editor → offers**, copy the `token` and open `APP_URL/s/<token>`. Tick the PPE and accept. The board updates within 15 seconds.

## 6. Turn on real texts (Twilio)

1. Create a Twilio account and upgrade it (add payment).
2. **Buy a UK mobile number** (Phone Numbers → Buy a number → United Kingdom → Mobile, SMS enabled). UK numbers need a quick **regulatory bundle**: your business name, address and a document. Twilio walks you through it. Approval usually takes 1–3 working days.
3. On the number's settings page, under **Messaging → A message comes in**: Webhook, `APP_URL/api/sms/inbound`, method **HTTP POST**. Save.
4. In Vercel, add `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (Twilio Console home page) and `TWILIO_FROM_NUMBER` (the number you bought, e.g. `+447700900000`). **Redeploy**.
5. Test with your own mobile: add yourself, reply YES, send yourself a shift and accept it.

## 7. Invite your consultants

**Team → Invite a consultant**. They get an email to set a password, then set up their authenticator app. Add their mobile if they want a text whenever a temp accepts one of their shifts.

## 8. Before real temps use it

- [ ] Ask a developer to spend a few hours reviewing the setup and security.
- [ ] Update your privacy notice to cover ShiftReady (name, mobile, postcode, job types, texts) and link it on your website.
- [ ] Record ShiftReady in your data protection records (and a short DPIA). Check your ICO registration covers it.
- [ ] Decide how long you keep temps who never opt in or who opt out, and delete them on that schedule (Temps → Delete, admins only).
- [ ] Supabase: upgrade to a paid plan before launch for daily backups.
- [ ] Pilot with one client and around 30 temps first.

## Day-to-day notes

- **Reminders** go out every day at 17:00 UTC (5pm in winter, 6pm in summer) to everyone booked on tomorrow's shifts.
- **Text wording** is all in `src/lib/texts.ts`.
- **Job types and PPE options** are in `src/lib/format.ts`.
- **Costs**: roughly 3–5p per text with Twilio, plus Supabase ($25/month on Pro) and Vercel (free tier to start; Pro is $20/user/month if you outgrow it).

## Online registration (Sign-ups)

1. **Database:** Supabase > SQL Editor > New query. Paste all of `supabase/2026-10-27-registration.sql` and click Run.
2. **Encryption key:** on a Mac, open Terminal and run `openssl rand -base64 32`. In Vercel > Settings > Environment Variables add `FIELD_ENCRYPTION_KEY` with that value. Save a copy in your password manager. Never change or lose it: candidates' NI numbers, health, convictions and bank details can't be read without it. Then redeploy.
3. **Documents:** Team > Documents. Have your employment adviser check the Key Information Document, terms and privacy notice. Edit and save as needed (each save is a new version).
4. **Test:** Sign-ups > send a registration link to your own mobile and fill it in.

How it works: consultant sends a link > candidate registers on their phone (details, right to work, emergency contact, health, convictions, 48-hour choice, signs the documents) > appears under Sign-ups > consultant checks right to work on GOV.UK and uploads the result > approves > temp gets shifts. Bank details are asked for when they accept their first shift. Right to work with an end date shows under Sign-ups 28 days before, and the temp is put on hold automatically when it expires.
