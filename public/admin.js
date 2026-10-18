class AdminDashboard {
  constructor() {
    this.registrations = [];
    this.loginForm = document.getElementById("loginForm");
    this.loginForm.addEventListener("submit", e => this.login(e));
    document.getElementById("logout").addEventListener("click", () => this.logout());
    document.getElementById("export").addEventListener("click", () => { location.href = "/api/admin/export.csv"; });
    document.getElementById("search").addEventListener("input", () => this.renderRows());
    document.getElementById("categoryFilter").addEventListener("change", () => this.renderRows());
    document.getElementById("statusFilter").addEventListener("change", () => this.renderRows());
    this.checkSession();
  }
  async request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  showMessage(id, message, type = "error") {
    const el = document.getElementById(id);
    el.textContent = message;
    el.className = "status " + type;
    el.classList.remove("hidden");
  }
  async checkSession() {
    try { await this.request("/api/admin/me"); await this.showDashboard(); }
    catch { this.showLogin(); }
  }
  showLogin() {
    document.getElementById("loginView").classList.remove("hidden");
    document.getElementById("dashboardView").classList.add("hidden");
  }
  async showDashboard() {
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("dashboardView").classList.remove("hidden");
    await this.loadData();
  }
  async login(event) {
    event.preventDefault();
    const button = this.loginForm.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await this.request("/api/admin/login", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          username: document.getElementById("username").value,
          password: document.getElementById("password").value
        })
      });
      document.getElementById("password").value = "";
      await this.showDashboard();
    } catch (err) { this.showMessage("loginStatus", err.message); }
    finally { button.disabled = false; }
  }
  async logout() {
    try { await this.request("/api/admin/logout", { method: "POST" }); }
    finally { this.showLogin(); }
  }
  async loadData() {
    try {
      const data = await this.request("/api/admin/registrations");
      this.registrations = data.registrations;
      document.getElementById("applicants").textContent = this.registrations.filter(r => r.status !== "Cancelled").length;
      document.getElementById("gec").textContent = data.availability.remaining.GEC120;
      document.getElementById("fpe").textContent = data.availability.remaining.FPE101;
      document.getElementById("vol").textContent = data.availability.remaining.NONE;
      this.renderRows();
    } catch (err) {
      this.showMessage("dashStatus", err.message);
      if (err.message.includes("login")) this.showLogin();
    }
  }
  renderRows() {
    const query = document.getElementById("search").value.toLowerCase().trim();
    const category = document.getElementById("categoryFilter").value;
    const status = document.getElementById("statusFilter").value;
    const rows = this.registrations.filter(r => {
      const matchesText = [r.fullName, r.ticketId, r.program, r.subject || ""].join(" ").toLowerCase().includes(query);
      return matchesText && (!category || r.category === category) && (!status || r.status === status);
    });
    document.getElementById("shown").textContent = `${rows.length} shown`;
    const tbody = document.getElementById("rows");
    tbody.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 7; td.className = "empty"; td.textContent = "No registrations match this filter.";
      tr.append(td); tbody.append(tr); return;
    }
    for (const item of rows) {
      const tr = document.createElement("tr");
      const values = [
        item.ticketId, item.fullName, item.program,
        item.attendanceRequired ? "Yes" : "No",
        item.subject ? (item.subject === "GEC120" ? "GEC 120" : "FPE 101") : "No subject required",
        new Date(item.createdAt).toLocaleString()
      ];
      for (const value of values) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      const statusTd = document.createElement("td");
      const select = document.createElement("select");
      for (const optionValue of ["Registered", "Checked in", "Cancelled"]) {
        const option = document.createElement("option");
        option.value = optionValue; option.textContent = optionValue; option.selected = item.status === optionValue;
        select.append(option);
      }
      select.addEventListener("change", async () => {
        select.disabled = true;
        try {
          await this.request(`/api/admin/registrations/${item.id}/status`, {
            method: "PATCH", headers: {"Content-Type":"application/json"},
            body: JSON.stringify({status: select.value})
          });
          await this.loadData();
        } catch (err) { this.showMessage("dashStatus", err.message); select.value = item.status; }
        finally { select.disabled = false; }
      });
      statusTd.append(select); tr.append(statusTd); tbody.append(tr);
    }
  }
}
document.addEventListener("DOMContentLoaded", () => new AdminDashboard());