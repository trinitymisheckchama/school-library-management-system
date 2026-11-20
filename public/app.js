const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

const state = {
  user: null,
  page: "catalog",
  search: "",
  category: "",
  books: [],
  categories: [],
  loans: [],
  managerLoanSearch: "",
  managerLoanStatus: "all",
  summary: null,
  managerTab: "requests",
  pickupCheck: null,
  authMode: "login",
  toastTimer: null
};

const icons = {
  catalog: "▤",
  loans: "↗",
  requests: "◷",
  manage: "▧",
  people: "♧"
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "B";
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function notify(message, type = "success") {
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.className = "toast"; }, 3200);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function pageTitle() {
  return ({
    catalog: "Discover books",
    loans: "My reading shelf",
    dashboard: "Library overview"
  })[state.page] || "Discover books";
}

function navButton(page, label, icon) {
  return `<button class="nav-item${state.page === page ? " active" : ""}" data-page="${page}">
    <span class="nav-icon">${icon}</span>${label}
  </button>`;
}

function sidebar() {
  const manager = state.user?.role === "manager";
  return `<aside class="sidebar" id="sidebar">
    <a class="brand" href="#" data-page="catalog">
      <span class="brand-mark">b.</span>
      <span><span class="brand-name">booknook</span><span class="brand-caption">your school library</span></span>
    </a>
    <div class="nav-label">Library</div>
    <nav class="nav-list" aria-label="Main navigation">
      ${navButton("catalog", "Browse books", icons.catalog)}
      ${state.user && !manager ? navButton("loans", "My reading shelf", icons.loans) : ""}
      ${manager ? navButton("dashboard", "Manager dashboard", icons.manage) : ""}
    </nav>
    <div class="sidebar-bottom">
      <div class="reading-card"><strong>A little reading goes a long way.</strong><p>Find your next favorite book right here in your school library.</p></div>
      ${state.user ? `<div class="sidebar-profile">
        <span class="avatar">${escapeHtml(initials(state.user.name))}</span>
        <span class="profile-meta"><span class="profile-name">${escapeHtml(state.user.name)}</span><span class="profile-role">${escapeHtml(state.user.role)}</span></span>
        <button class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">↗</button>
      </div>` : `<div class="sidebar-profile"><button class="button button-secondary" data-page="login" style="width:100%">Sign in</button></div>`}
    </div>
  </aside>`;
}

function shell(content) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `<div class="layout">
    ${sidebar()}
    <main class="main-area">
      <header class="topbar">
        <div class="topbar-left"><button class="icon-button mobile-menu" data-action="menu" aria-label="Open menu">☰</button><div class="breadcrumbs">Library <span aria-hidden="true">/</span> <strong>${escapeHtml(pageTitle())}</strong></div></div>
        <div class="topbar-right"><span class="today">${today}</span>${state.user ? `<span class="avatar">${escapeHtml(initials(state.user.name))}</span>` : `<button class="button button-small" data-page="login">Sign in</button>`}</div>
      </header>
      <section class="content">${content}</section>
    </main>
  </div>`;
}

function bookCard(book, index) {
  const available = book.availableCopies > 0;
  const action = !state.user ? `<button class="button button-secondary" data-page="login">Sign in</button>` :
    state.user.role === "manager" ? `<button class="button button-secondary" data-action="edit-book" data-id="${book.id}">Edit</button>` :
      `<button class="button" data-action="borrow" data-id="${book.id}" ${available ? "" : "disabled"}>${available ? "Request" : "Unavailable"}</button>`;
  return `<article class="book-card">
    <div class="book-cover cover-${index % 8}"><span class="cover-title">${escapeHtml(book.title)}</span></div>
    <div class="book-info">
      <div class="book-category">${escapeHtml(book.category)}</div>
      <h3 class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</h3>
      <p class="book-author">by ${escapeHtml(book.author)}</p>
      <div class="book-foot"><span class="availability${available ? "" : " unavailable"}">${book.availableCopies} available</span>${action}</div>
    </div>
  </article>`;
}

function catalogPage() {
  const welcome = state.user ? `Welcome back, ${state.user.name.split(" ")[0]}.` : "A good book is waiting for you.";
  const isManager = state.user?.role === "manager";
  return `${!state.user ? `<section class="hero">
      <div class="hero-copy"><div class="eyebrow">A quieter kind of adventure</div><h1>${escapeHtml(welcome)}</h1>
      <p>Find a new favorite, revisit a classic, or discover somewhere completely unexpected — all from your school library.</p>
      <button class="button" data-scroll="catalog-list">Explore the collection <span aria-hidden="true">→</span></button></div>
      <div class="hero-art" aria-hidden="true"></div>
    </section>` : ""}
    ${isManager ? `<div class="manager-heading"><div><div class="eyebrow">Library collection</div><h1>Browse books</h1><p class="page-subtitle">Manage your catalog or check the current availability.</p></div><button class="button" data-action="add-book">＋ Add a book</button></div>` : ""}
    <div id="catalog-list" class="section-heading">
      <div><h2>${!isManager ? "A few good stories" : ""}</h2><p>${state.books.length} ${state.books.length === 1 ? "book" : "books"} in the collection</p></div>
      ${!state.user ? `<button class="text-button" data-page="login">My reading shelf →</button>` : ""}
    </div>
    <div class="catalog-tools">
      <label class="search-box"><span aria-hidden="true">⌕</span><input class="field" id="search" type="search" placeholder="Search title, author, or subject..." value="${escapeHtml(state.search)}" aria-label="Search books"></label>
      <select class="field filter-select" id="category" aria-label="Filter by category">
        <option value="">All subjects</option>
        ${state.categories.map((category) => `<option value="${escapeHtml(category)}" ${state.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
      </select>
    </div>
    ${state.books.length ? `<div class="book-grid">${state.books.map(bookCard).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">⌕</div>No books match your search. Try another title or subject.</div>`}
    ${!state.user ? `<div style="margin-top:35px;padding:24px;border-radius:10px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap">
      <div><strong style="font-family:'Playfair Display',serif;font-size:17px">Ready to borrow your first book?</strong><p style="margin:5px 0 0;color:var(--muted);font-size:11px">Sign in or create your free student account to get started.</p></div><button class="button" data-page="register">Join the library</button>
    </div>` : ""}`;
}

function statusBadge(status) {
  return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status.replaceAll("_", " "))}</span>`;
}

function loanDisplayStatus(loan) {
  if (!["approved", "return_requested"].includes(loan.status) || !loan.dueAt) return loan.status;
  const dueAt = new Date(loan.dueAt.includes("T") ? loan.dueAt : `${loan.dueAt.replace(" ", "T")}Z`);
  return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now() ? "overdue" : loan.status;
}

function filteredManagerLoans() {
  const search = state.managerLoanSearch.trim().toLowerCase();
  return state.loans.filter((loan) => {
    const matchesSearch = !search || [loan.studentName, loan.studentEmail, loan.title, loan.author, loan.pickupCode]
      .some((value) => String(value || "").toLowerCase().includes(search));
    const matchesStatus = state.managerLoanStatus === "all" || loanDisplayStatus(loan) === state.managerLoanStatus;
    return matchesSearch && matchesStatus;
  });
}

function loanRows(loans, manager = false) {
  if (!loans.length) return "";
  return loans.map((loan) => {
    const actions = manager ? `<div class="table-actions">
      ${loan.status === "pending" ? `<button class="button button-small" data-action="loan" data-id="${loan.id}" data-value="approve">Approve</button><button class="button button-danger button-small" data-action="loan" data-id="${loan.id}" data-value="reject">Decline</button>` : ""}
      ${loan.status === "return_requested" || loan.status === "approved" ? `<button class="button button-secondary button-small" data-action="loan" data-id="${loan.id}" data-value="mark_returned">Mark returned</button>` : ""}
    </div>` : loan.status === "approved" ? `<button class="button button-secondary button-small" data-action="return" data-id="${loan.id}">Request return</button>` : "—";
    return `<tr>
      ${manager ? `<td><div class="table-book">${escapeHtml(loan.studentName)}</div><div class="table-sub">${escapeHtml(loan.studentEmail)}</div></td>` : ""}
      <td><div class="table-book">${escapeHtml(loan.title)}</div><div class="table-sub">${escapeHtml(loan.author)}</div></td>
      ${manager ? "" : `<td><span class="pickup-code">${escapeHtml(loan.pickupCode || "—")}</span></td>`}
      <td>${statusBadge(loanDisplayStatus(loan))}</td><td>${formatDate(loan.requestedAt)}</td>
      <td>${formatDate(loan.dueAt)}</td><td>${actions}</td>
    </tr>`;
  }).join("");
}

function myLoansPage() {
  return `<div class="eyebrow">Your books</div><h1>My reading shelf</h1>
    <p class="page-subtitle">Keep track of requests, books to enjoy, and returns — all in one place.</p>
    <div class="table-wrap">
      ${state.loans.length ? `<table class="data-table"><thead><tr><th>Book</th><th>Pickup code</th><th>Status</th><th>Requested</th><th>Due date</th><th>Action</th></tr></thead><tbody>${loanRows(state.loans)}</tbody></table>` :
        `<div class="empty-state"><div class="empty-icon">▤</div>Your shelf is still empty.<br>Find a book you love and send a borrow request.</div>`}
    </div>
    <button class="button button-secondary" style="margin-top:17px" data-page="catalog">Browse the collection</button>`;
}

function managerDashboard() {
  const summary = state.summary || { books: 0, copies: 0, students: 0, pending: 0, active: 0 };
  const tabContent = state.managerTab === "books" ?
    `<div class="section-heading"><div><h2>Book catalog</h2><p>Update book details and copy counts.</p></div><button class="button button-small" data-action="add-book">＋ Add a book</button></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Book</th><th>Subject</th><th>Available</th><th>Total copies</th><th>Action</th></tr></thead><tbody>
      ${state.books.map((book) => `<tr><td><div class="table-book">${escapeHtml(book.title)}</div><div class="table-sub">${escapeHtml(book.author)}</div></td><td>${escapeHtml(book.category)}</td><td>${book.availableCopies}</td><td>${book.totalCopies}</td><td><div class="table-actions"><button class="button button-secondary button-small" data-action="edit-book" data-id="${book.id}">Edit</button><button class="button button-danger button-small" data-action="delete-book" data-id="${book.id}">Remove</button></div></td></tr>`).join("")}
    </tbody></table></div>` :
    state.managerTab === "pickup" ?
      `<div class="section-heading"><div><h2>Verify a pickup</h2><p>Check the student and request before handing over a book.</p></div></div>
      <form id="pickup-check-form" class="pickup-check-form">
        <label class="form-field" for="pickup-code-input">Six-digit pickup code<input class="field" id="pickup-code-input" name="code" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"></label>
        <button class="button" type="submit">Check code</button>
      </form>
      ${state.pickupCheck ? `<section class="pickup-result" aria-live="polite"><div class="eyebrow">Pickup code ${escapeHtml(state.pickupCheck.code)}</div><h2>${escapeHtml(state.pickupCheck.title)}</h2><p>Student: <strong>${escapeHtml(state.pickupCheck.studentName)}</strong> (${escapeHtml(state.pickupCheck.studentEmail)})</p><p>Status: ${statusBadge(state.pickupCheck.status)}</p><p class="pickup-verdict ${state.pickupCheck.canCollect ? "ready" : "waiting"}">${state.pickupCheck.canCollect ? "Approved. You may hand over this book." : "This request is not approved for collection yet."}</p></section>` : ""}` :
      `<div class="section-heading"><div><h2>Borrow requests &amp; loans</h2><p>Review student requests and check books back in.</p></div></div>
      <div class="manager-loan-filters">
        <label class="search-box"><span aria-hidden="true">⌕</span><input class="field" id="manager-loan-search" type="search" value="${escapeHtml(state.managerLoanSearch)}" placeholder="Search student, book, or pickup code" aria-label="Search loan history"></label>
        <select class="field" id="manager-loan-status" aria-label="Filter loans by status">
          ${[["all", "All statuses"], ["pending", "Pending"], ["approved", "Approved"], ["overdue", "Overdue"], ["return_requested", "Return requested"], ["returned", "Returned"], ["rejected", "Rejected"]].map(([value, label]) => `<option value="${value}" ${state.managerLoanStatus === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
      <div class="table-wrap">${filteredManagerLoans().length ? `<table class="data-table"><thead><tr><th>Student</th><th>Book</th><th>Status</th><th>Requested</th><th>Due date</th><th>Action</th></tr></thead><tbody>${loanRows(filteredManagerLoans(), true)}</tbody></table>` : `<div class="empty-state">No loans match these filters.</div>`}</div>`;
  return `<div class="eyebrow">Staff workspace</div><h1>Library overview</h1><p class="page-subtitle">A quick look at your collection and what needs your attention.</p>
    <div class="stats-grid">
      <div class="stat-card"><span class="stat-icon">${icons.catalog}</span><span><span class="stat-label">Book titles</span><div class="stat-value">${summary.books}</div></span></div>
      <div class="stat-card"><span class="stat-icon">◷</span><span><span class="stat-label">Needs review</span><div class="stat-value">${summary.pending}</div></span></div>
      <div class="stat-card"><span class="stat-icon">↗</span><span><span class="stat-label">Books on loan</span><div class="stat-value">${summary.active}</div></span></div>
      <div class="stat-card"><span class="stat-icon">${icons.people}</span><span><span class="stat-label">Student members</span><div class="stat-value">${summary.students}</div></span></div>
    </div>
    <div class="manager-tabs" role="tablist">
      <button class="tab-button${state.managerTab === "requests" ? " active" : ""}" role="tab" data-tab="requests">Requests &amp; loans</button>
      <button class="tab-button${state.managerTab === "books" ? " active" : ""}" role="tab" data-tab="books">Book catalog</button>
      <button class="tab-button${state.managerTab === "pickup" ? " active" : ""}" role="tab" data-tab="pickup">Verify pickup</button>
    </div>
    ${tabContent}`;
}

function authPage() {
  const isRegister = state.authMode === "register";
  const fields = isRegister ? `<div class="form-field"><label for="name">Your name</label><input class="field" id="name" name="name" autocomplete="name" maxlength="80" required placeholder="e.g. Alex Morgan"></div>` : "";
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="eyebrow">${isRegister ? "Welcome to booknook" : "Your school library"}</div>
    <h1>${isRegister ? "Join the library." : "Welcome back."}</h1>
    <p class="page-subtitle">${isRegister ? "Create a student account to request books and keep track of your loans." : "Sign in to browse, request books, and see what's on your shelf."}</p>
    <form id="auth-form" class="form-stack">
      ${fields}
      <div class="form-field"><label for="email">Email address</label><input class="field" id="email" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@school.edu"></div>
      <div class="form-field"><label for="password">Password</label><input class="field" id="password" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="${isRegister ? "8" : "1"}" required placeholder="${isRegister ? "At least 8 characters" : "Enter your password"}"></div>
      <button class="button" type="submit" style="width:100%;margin-top:4px">${isRegister ? "Create student account" : "Sign in"}</button>
    </form>
    <p class="auth-switch">${isRegister ? "Already have an account?" : "New to the library?"} <button class="text-button" data-action="switch-auth">${isRegister ? "Sign in" : "Create an account"}</button></p>
  </div></div>`;
}

function render() {
  const searchInput = ["search", "manager-loan-search"].includes(document.activeElement?.id) ? document.activeElement : null;
  const selectionStart = searchInput?.selectionStart;
  const selectionEnd = searchInput?.selectionEnd;
  const content = state.page === "login" || state.page === "register" ? authPage() :
    state.page === "loans" ? myLoansPage() :
      state.page === "dashboard" ? managerDashboard() : catalogPage();
  app.innerHTML = shell(content);
  if (searchInput) {
    const updatedSearch = app.querySelector("#search");
    updatedSearch?.focus();
    if (selectionStart !== null && selectionEnd !== null) {
      updatedSearch?.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

async function loadBooks() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.category) params.set("category", state.category);
  const result = await request(`/api/books?${params}`);
  state.books = result.books;
  state.categories = result.categories;
}

async function loadLoans() {
  if (!state.user) {
    state.loans = [];
    return;
  }
  const result = await request("/api/loans");
  state.loans = result.loans;
}

async function loadManagerData() {
  if (state.user?.role !== "manager") return;
  const [summary, loans] = await Promise.all([request("/api/manager/summary"), request("/api/loans")]);
  state.summary = summary;
  state.loans = loans.loans;
}

async function navigate(page) {
  if (page === "loans" && state.user?.role !== "student") page = state.user ? "catalog" : "login";
  if (page === "dashboard" && state.user?.role !== "manager") page = state.user ? "catalog" : "login";
  state.page = page;
  if (page === "register") state.authMode = "register";
  if (page === "login") state.authMode = "login";
  await loadBooks();
  if (page === "loans") await loadLoans();
  if (page === "dashboard") await loadManagerData();
  render();
}

function bookForm(book) {
  const editing = Boolean(book);
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="book-modal-title">
    <div class="modal-top"><div><h2 id="book-modal-title">${editing ? "Update book" : "Add a book"}</h2><p>${editing ? "Edit the catalog details and copy count." : "Add a new title to the school collection."}</p></div><button class="icon-button" data-close aria-label="Close dialog">×</button></div>
    <form id="book-form"><div class="form-grid">
      <div class="form-field form-span"><label for="book-title">Title</label><input class="field" id="book-title" name="title" maxlength="160" required value="${escapeHtml(book?.title || "")}"></div>
      <div class="form-field"><label for="book-author">Author</label><input class="field" id="book-author" name="author" maxlength="120" required value="${escapeHtml(book?.author || "")}"></div>
      <div class="form-field"><label for="book-category">Subject</label><input class="field" id="book-category" name="category" maxlength="60" required value="${escapeHtml(book?.category || "General")}"></div>
      <div class="form-field"><label for="book-isbn">ISBN</label><input class="field" id="book-isbn" name="isbn" maxlength="32" value="${escapeHtml(book?.isbn || "")}"></div>
      <div class="form-field"><label for="book-copies">Total copies</label><input class="field" id="book-copies" name="totalCopies" type="number" min="0" max="10000" required value="${book ? book.totalCopies : 1}"></div>
      <div class="form-field form-span"><label for="book-description">Short description</label><textarea class="field" id="book-description" name="description" maxlength="500">${escapeHtml(book?.description || "")}</textarea></div>
    </div><div class="form-actions"><button type="button" class="button button-secondary" data-close>Cancel</button><button class="button" type="submit">${editing ? "Save changes" : "Add to catalog"}</button></div></form>
  </section>`;
  document.body.append(modal);
  modal.querySelector("[name=title]").focus();
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close]")) modal.remove();
  });
  modal.querySelector("#book-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    payload.totalCopies = Number(payload.totalCopies);
    try {
      await request(editing ? `/api/manager/books/${book.id}` : "/api/manager/books", {
        method: editing ? "PATCH" : "POST", body: JSON.stringify(payload)
      });
      modal.remove();
      await refreshCurrentPage();
      notify(editing ? "Book details updated." : "Book added to the catalog.");
    } catch (error) { notify(error.message, "error"); }
  });
}

function approvalForm(loanId) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  const today = new Date().toISOString().slice(0, 10);
  modal.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="approval-modal-title">
    <div class="modal-top"><div><h2 id="approval-modal-title">Set return date</h2><p>Choose when this book should be returned.</p></div><button class="icon-button" data-close aria-label="Close dialog">×</button></div>
    <form id="approve-loan-form" class="form-stack">
      <div class="form-field"><label for="loan-due-date">Due date</label><input class="field" id="loan-due-date" name="dueDate" type="date" min="${today}" required></div>
      <div class="form-actions"><button type="button" class="button button-secondary" data-close>Cancel</button><button class="button" type="submit">Approve request</button></div>
    </form>
  </section>`;
  document.body.append(modal);
  modal.querySelector("#loan-due-date").focus();
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.closest("[data-close]")) modal.remove();
  });
  modal.querySelector("#approve-loan-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const dueDate = new FormData(form).get("dueDate");
      const result = await request(`/api/manager/loans/${loanId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", dueDate })
      });
      modal.remove();
      await refreshCurrentPage();
      notify(result.message);
    } catch (error) {
      notify(error.message, "error");
      button.disabled = false;
    }
  });
}

async function refreshCurrentPage() {
  await loadBooks();
  if (state.page === "dashboard") {
    const [summary, loans] = await Promise.all([request("/api/manager/summary"), request("/api/loans")]);
    state.summary = summary;
    state.loans = loans.loans;
  } else if (state.page === "loans") {
    await loadLoans();
  }
  render();
}

let searchTimer;
document.addEventListener("input", (event) => {
  if (event.target.id === "manager-loan-search") {
    state.managerLoanSearch = event.target.value;
    render();
    return;
  }
  if (event.target.id !== "search") return;
  state.search = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    searchTimer = null;
    try {
      await loadBooks();
      if (state.page === "catalog") render();
    } catch (error) {
      notify(error.message, "error");
    }
  }, 180);
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "manager-loan-status") {
    state.managerLoanStatus = event.target.value;
    render();
    return;
  }
  if (event.target.id !== "category") return;
  state.category = event.target.value;
  await loadBooks();
  render();
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "pickup-check-form") {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      state.pickupCheck = await request("/api/manager/pickup-check", {
        method: "POST",
        body: JSON.stringify({ code: new FormData(form).get("code") })
      });
      render();
    } catch (error) {
      state.pickupCheck = null;
      notify(error.message, "error");
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (event.target.id !== "auth-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const isRegister = state.authMode === "register";
  const body = isRegister
    ? { name: form.get("name"), email: form.get("email"), password: form.get("password") }
    : { email: form.get("email"), password: form.get("password") };
  const button = event.target.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const result = await request(`/api/auth/${isRegister ? "register" : "login"}`, { method: "POST", body: JSON.stringify(body) });
    state.user = result.user;
    state.page = result.user.role === "manager" ? "dashboard" : "catalog";
    await loadBooks();
    if (state.page === "dashboard") {
      const [summary, loans] = await Promise.all([request("/api/manager/summary"), request("/api/loans")]);
      state.summary = summary;
      state.loans = loans.loans;
    }
    render();
    notify(isRegister ? "Your student account is ready." : `Welcome back, ${result.user.name.split(" ")[0]}.`);
  } catch (error) {
    notify(error.message, "error");
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    await navigate(pageButton.dataset.page);
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.managerTab = tab.dataset.tab;
    state.pickupCheck = null;
    render();
    return;
  }
  const scrollButton = event.target.closest("[data-scroll]");
  if (scrollButton) {
    document.getElementById(scrollButton.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  try {
    if (action.dataset.action === "switch-auth") {
      state.authMode = state.authMode === "login" ? "register" : "login";
      state.page = state.authMode;
      render();
    } else if (action.dataset.action === "logout") {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
      state.user = null;
      state.summary = null;
      state.loans = [];
      state.page = "catalog";
      await loadBooks();
      render();
      notify("You have signed out.");
    } else if (action.dataset.action === "menu") {
      document.querySelector("#sidebar")?.classList.toggle("open");
    } else if (action.dataset.action === "borrow") {
      const result = await request("/api/loans", { method: "POST", body: JSON.stringify({ bookId: Number(action.dataset.id) }) });
      await refreshCurrentPage();
      await loadLoans();
      const loan = state.loans.find((item) => Number(item.id) === Number(result.loanId));
      const pickupCode = result.pickupCode || loan?.pickupCode;
      notify(pickupCode
        ? `Request sent. Your pickup code is ${pickupCode}.`
        : "Request sent. Check your reading shelf for the pickup code.");
    } else if (action.dataset.action === "return") {
      const result = await request(`/api/loans/${action.dataset.id}/return`, { method: "POST", body: "{}" });
      await refreshCurrentPage();
      notify(result.message);
    } else if (action.dataset.action === "loan") {
      if (action.dataset.value === "approve") {
        approvalForm(Number(action.dataset.id));
        return;
      }
      const result = await request(`/api/manager/loans/${action.dataset.id}`, {
        method: "PATCH", body: JSON.stringify({ action: action.dataset.value })
      });
      await refreshCurrentPage();
      notify(result.message);
    } else if (action.dataset.action === "add-book") {
      bookForm();
    } else if (action.dataset.action === "edit-book") {
      const book = state.books.find((item) => item.id === Number(action.dataset.id));
      if (book) bookForm(book);
    } else if (action.dataset.action === "delete-book") {
      const book = state.books.find((item) => item.id === Number(action.dataset.id));
      if (!book || !confirm(`Remove "${book.title}" from the catalog?`)) return;
      await request(`/api/manager/books/${book.id}`, { method: "DELETE" });
      await refreshCurrentPage();
      notify("Book removed from the catalog.");
    }
  } catch (error) { notify(error.message, "error"); }
});

async function start() {
  try {
    const session = await request("/api/session");
    state.user = session.user;
    if (state.user?.role === "manager") state.page = "dashboard";
    await loadBooks();
    if (state.page === "dashboard") {
      const [summary, loans] = await Promise.all([request("/api/manager/summary"), request("/api/loans")]);
      state.summary = summary;
      state.loans = loans.loans;
    }
    render();
  } catch (error) {
    app.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="eyebrow">Library unavailable</div><h1>We couldn't open the library.</h1><p class="page-subtitle">${escapeHtml(error.message)}</p><button class="button" onclick="location.reload()">Try again</button></div></div>`;
  }
}

start();
