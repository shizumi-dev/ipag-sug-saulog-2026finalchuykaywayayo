class RegistrationPage {
  constructor() {
    this.form = document.getElementById("form");
    this.form.addEventListener("change", () => this.toggleSubject());
    this.form.addEventListener("submit", (event) => this.submit(event));
    document.getElementById("print").addEventListener("click", () => window.print());
    document.getElementById("newRegistration").addEventListener("click", () => location.reload());
    this.toggleSubject();
    this.refreshAvailability();
    this.checkDeadline();
  }

  toggleSubject() {
    const selected = document.querySelector('input[name="required"]:checked')?.value;
    const field = document.getElementById("subjectField");
    const subject = document.getElementById("subject");
    field.classList.toggle("hidden", selected !== "yes");
    subject.required = selected === "yes";
    if (selected !== "yes") subject.value = "";
  }

  showStatus(message, type = "error") {
    const status = document.getElementById("status");
    status.textContent = message;
    status.className = "status show " + type;
  }

  async refreshAvailability() {
    try {
      const response = await fetch("/api/availability");
      const data = await response.json();
      this.setCount("gec", "gecBar", data.remaining.GEC120, 30);
      this.setCount("fpe", "fpeBar", data.remaining.FPE101, 30);
      this.setCount("vol", "volBar", data.remaining.NONE, 20);
      this.setCount("total", "totalBar", data.totalRemaining, 80);
      if (!data.registrationOpen) this.showClosed();
    } catch {
      this.showStatus("Could not reach the registration server. Refresh the page or contact the organizer.");
    }
  }

  setCount(numberId, barId, remaining, capacity) {
    document.getElementById(numberId).textContent = remaining;
    document.getElementById(barId).style.width = `${(remaining / capacity) * 100}%`;
  }

  checkDeadline() {
    // Server also enforces the deadline; this is only a display convenience.
    if (Date.now() >= new Date("2026-10-19T21:00:00.000Z").getTime()) this.showClosed();
  }

  showClosed() {
    document.getElementById("registrationView").classList.add("hidden");
    document.getElementById("confirmationView").classList.add("hidden");
    document.getElementById("closedView").classList.remove("hidden");
  }

  async submit(event) {
    event.preventDefault();
    const required = document.querySelector('input[name="required"]:checked')?.value;
    const payload = {
      fullName: document.getElementById("fullName").value.trim(),
      program: document.getElementById("program").value,
      required: required === "yes",
      subject: required === "yes" ? document.getElementById("subject").value : ""
    };
    const button = document.getElementById("submit");
    button.disabled = true;
    button.textContent = "Checking availability...";
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        this.showStatus(result.error || "Registration failed.");
        await this.refreshAvailability();
        return;
      }
      document.getElementById("registrationView").classList.add("hidden");
      document.getElementById("closedView").classList.add("hidden");
      document.getElementById("confirmationView").classList.remove("hidden");
      document.getElementById("ticketName").textContent = result.ticket.fullName;
      document.getElementById("ticketProgram").textContent = "Program: " + result.ticket.program;
      document.getElementById("ticketSubject").textContent =
        result.ticket.attendance === "Required" ? "Required subject: " + result.ticket.subject : "Attendance: Not required";
      document.getElementById("ticketId").textContent = "TICKET ID  " + result.ticket.ticketId;
      await this.refreshAvailability();
    } catch {
      this.showStatus("The server could not be reached. Your registration may not have been saved; please check with the organizer before retrying.");
    } finally {
      button.disabled = false;
      button.textContent = "Check availability and register";
    }
  }
}
document.addEventListener("DOMContentLoaded", () => new RegistrationPage());