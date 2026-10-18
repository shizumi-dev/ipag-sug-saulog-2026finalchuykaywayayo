# IPAG SUG-SAULOG 2026 — Supabase / Render deployment

This project uses PostgreSQL for registrations and administrator sessions. It does not use a local SQLite database.

## Before deployment
- Create a Supabase project.
- In Supabase, open **Project Settings → Database** and copy a PostgreSQL connection string compatible with Render. Keep it secret.
- Create a private GitHub repository. Never commit `.env`, database credentials, applicant exports, or `node_modules`.
- This is a deployment starter, not a professional security audit. Test with dummy records before accepting real applicant data.

## Local Windows setup
1. Copy `.env.example` to `.env`.
2. Replace `DATABASE_URL` with your Supabase connection string, and set a unique admin username, strong password, and random `SESSION_SECRET` (at least 32 characters).
3. Run `npm.cmd install`, then `npm.cmd start`.
4. Open `http://127.0.0.1:3000` and `http://127.0.0.1:3000/admin`.

## Render
1. Connect the private GitHub repository to Render as a Web Service or use the Blueprint.
2. Use build command `npm install` and start command `node server.js`.
3. Add environment variables `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET`; set `NODE_ENV=production` and `HOST=0.0.0.0`.
4. Free Render web services may sleep after inactivity; the first visit may be delayed. The local filesystem is ephemeral, which is why this app stores its records in PostgreSQL.
5. Supabase free tier limits and pause policies can change. Monitor the project during the event and make frequent private CSV exports as backups.

## Database behavior
On startup, the app creates the `registrations` and `web_sessions` tables if they do not exist. The `web_sessions` table is managed by `connect-pg-simple`. Capacity checks use PostgreSQL advisory transaction locks to reduce the risk of overbooking.

## Important launch checks
- Confirm the registration deadline and event details in `server.js` and `public/app.js` match the event.
- Test a dummy registration, admin login, status update, CSV export, logout, and persistence after a redeploy.
- Ensure the Supabase connection string is private and database access is limited to the app.
- Publish a privacy notice and define who can access/export applicant data and when it will be deleted.
- Keep a backup of CSV exports in a secure location, not in the public repository.

This project has not been tested against your live Supabase project. Verify all routes with dummy data before launch.
