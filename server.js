require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET || !DATABASE_URL ||
    ADMIN_PASSWORD.includes("replace-this") || SESSION_SECRET.includes("replace-this")) {
  console.error("Setup required: set DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET in your host environment.");
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET should be at least 32 characters long.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Supabase's connection URL commonly requires TLS. Verify certificate validation.
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: true },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on("error", (err) => console.error("Unexpected PostgreSQL pool error:", err.message));

const CAPACITY = { GEC120: 30, FPE101: 30, NONE: 20 };
const DEADLINE = new Date("2026-10-19T21:00:00.000Z"); // October 20, 2026, 5:00 AM Philippines time
const PROGRAMS = new Set(["ANB", "BDV", "PLB", "MCB", "MRB", "STAT", "MATH", "CHEM", "PHY"]);
const SUBJECTS = new Set(["GEC120", "FPE101"]);

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id BIGSERIAL PRIMARY KEY,
      ticket_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      program TEXT NOT NULL,
      attendance_required BOOLEAN NOT NULL,
      subject TEXT,
      category TEXT NOT NULL CHECK(category IN ('GEC120','FPE101','NONE')),
      created_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'Registered'
    );
    CREATE INDEX IF NOT EXISTS idx_registrations_category ON registrations(category);
    CREATE INDEX IF NOT EXISTS idx_registrations_name ON registrations(full_name);
  `);
}

if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      baseUri: ["'self'"], formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

const sessionPool = pool;
app.use(session({
  name: "ipag_admin_session",
  store: new PgSession({
    pool: sessionPool,
    tableName: "web_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", dotfiles: "deny" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7",
  legacyHeaders: false, message: { error: "Too many login attempts. Please wait 15 minutes and try again." }
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7",
  legacyHeaders: false, message: { error: "Too many registration attempts from this connection. Please try again later." }
});
function adminOnly(req, res, next) {
  if (req.session && req.session.isAdmin === true) return next();
  return res.status(401).json({ error: "Administrator login required." });
}
function safeEqual(a, b) {
  const ah = crypto.createHash("sha256").update(String(a)).digest();
  const bh = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}
async function getCounts() {
  const result = await pool.query("SELECT category, COUNT(*)::int AS count FROM registrations WHERE status <> 'Cancelled' GROUP BY category");
  const used = { GEC120: 0, FPE101: 0, NONE: 0 };
  for (const row of result.rows) used[row.category] = row.count;
  const remaining = {};
  for (const key of Object.keys(CAPACITY)) remaining[key] = Math.max(0, CAPACITY[key] - used[key]);
  return { capacity: CAPACITY, used, remaining, totalCapacity: 80,
    totalUsed: used.GEC120 + used.FPE101 + used.NONE,
    totalRemaining: remaining.GEC120 + remaining.FPE101 + remaining.NONE };
}

app.get("/api/availability", async (req, res) => {
  try { res.json({ ...await getCounts(), registrationOpen: new Date() < DEADLINE }); }
  catch (err) { console.error("Availability error:", err.message); res.status(503).json({ error: "Availability is temporarily unavailable." }); }
});

app.post("/api/register", registrationLimiter, async (req, res) => {
  if (new Date() >= DEADLINE) return res.status(403).json({ error: "Free ticket registration is closed." });
  const fullName = typeof req.body.fullName === "string" ? req.body.fullName.trim().replace(/\s+/g, " ") : "";
  const program = typeof req.body.program === "string" ? req.body.program : "";
  const required = req.body.required === true || req.body.required === "true";
  const subject = typeof req.body.subject === "string" ? req.body.subject : "";
  if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
  if (!PROGRAMS.has(program)) return res.status(400).json({ error: "Choose a valid program." });
  if (required && !SUBJECTS.has(subject)) return res.status(400).json({ error: "Choose GEC 120 or FPE 101." });
  if (!required && subject) return res.status(400).json({ error: "A subject should not be selected for voluntary attendance." });

  const category = required ? subject : "NONE";
  const now = new Date().toISOString();
  const ticketId = "IPAG26-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize capacity checks per category to prevent overbooking.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [category]);
    const countResult = await client.query("SELECT COUNT(*)::int AS n FROM registrations WHERE category = $1 AND status <> 'Cancelled'", [category]);
    if (countResult.rows[0].n >= CAPACITY[category]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "There are no free tickets left in that category." });
    }
    await client.query(`
      INSERT INTO registrations (ticket_id, full_name, program, attendance_required, subject, category, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [ticketId, fullName, program, required, required ? subject : null, category, now]);
    await client.query("COMMIT");
    res.status(201).json({
      message: "Registration successful.",
      ticket: { ticketId, fullName, program, attendance: required ? "Required" : "Not required",
        subject: required ? (subject === "GEC120" ? "GEC 120" : "FPE 101") : "No subject required",
        event: "IPAG SUG-SAULOG 2026", dates: "October 22–24, 2026", venue: "AAMI Theater, MSU-IIT" },
      availability: await getCounts()
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("Registration error:", err.message);
    res.status(500).json({ error: "Could not save the registration. Please try again." });
  } finally { client.release(); }
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!safeEqual(username, ADMIN_USERNAME) || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start an administrator session." });
    req.session.isAdmin = true;
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: "Could not save administrator session." });
      res.json({ message: "Logged in." });
    });
  });
});
app.post("/api/admin/logout", adminOnly, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("ipag_admin_session", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    res.json({ message: "Logged out." });
  });
});
app.get("/api/admin/me", adminOnly, (req, res) => res.json({ authenticated: true }));
app.get("/api/admin/registrations", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, ticket_id AS "ticketId", full_name AS "fullName", program,
        attendance_required AS "attendanceRequired", subject, category,
        created_at AS "createdAt", status FROM registrations ORDER BY id DESC
    `);
    res.json({ registrations: result.rows, availability: await getCounts() });
  } catch (err) { console.error("Admin list error:", err.message); res.status(500).json({ error: "Could not load registrations." }); }
});
app.get("/api/admin/export.csv", adminOnly, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ticket_id AS "Ticket ID", full_name AS "Full name", program AS "Program",
        CASE WHEN attendance_required THEN 'Yes' ELSE 'No' END AS "Attendance required",
        COALESCE(subject, 'No subject required') AS "Subject",
        category AS "Ticket category", created_at AS "Registered at", status AS "Status"
      FROM registrations ORDER BY id ASC
    `);
    const columns = ["Ticket ID", "Full name", "Program", "Attendance required", "Subject", "Ticket category", "Registered at", "Status"];
    const escapeCsv = (value) => {
      let s = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = [columns.map(escapeCsv).join(","), ...result.rows.map(row => columns.map(col => escapeCsv(row[col])).join(","))].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="ipag-registrations.csv"');
    res.send("\uFEFF" + csv);
  } catch (err) { console.error("CSV export error:", err.message); res.status(500).json({ error: "Could not export registrations." }); }
});
app.patch("/api/admin/registrations/:id/status", adminOnly, async (req, res) => {
  const allowed = new Set(["Registered", "Checked in", "Cancelled"]);
  if (!allowed.has(req.body.status)) return res.status(400).json({ error: "Invalid status." });
  try {
    const result = await pool.query("UPDATE registrations SET status = $1 WHERE id = $2 RETURNING id", [req.body.status, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Registration not found." });
    res.json({ message: "Status updated.", availability: await getCounts() });
  } catch (err) { console.error("Status update error:", err.message); res.status(500).json({ error: "Could not update status." }); }
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

initializeDatabase().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`IPAG registration server running on ${HOST}:${PORT}`);
    console.log(`Admin dashboard: http://${HOST}:${PORT}/admin`);
  });
}).catch((err) => {
  console.error("Could not initialize PostgreSQL database:", err.message);
  process.exit(1);
});
