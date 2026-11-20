require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const { pool, initializeDatabase } = require("./database");

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const sessionLifetime = 7 * 24 * 60 * 60;

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is unset. Set it in production to keep sessions valid across restarts.");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function signSession(id) {
  return crypto.createHmac("sha256", sessionSecret).update(id).digest("base64url");
}

function setSessionCookie(res, id) {
  const token = `${id}.${signSession(id)}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `library_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `library_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function cookieValue(req, name) {
  const cookie = (req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(name.length + 1));
  } catch {
    return null;
  }
}

async function queryOne(sql, values = [], connection = pool) {
  const [rows] = await connection.execute(sql, values);
  return rows[0] || null;
}

async function queryAll(sql, values = [], connection = pool) {
  const [rows] = await connection.execute(sql, values);
  return rows;
}

async function execute(sql, values = [], connection = pool) {
  const [result] = await connection.execute(sql, values);
  return result;
}

async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sessionUser(req) {
  const token = cookieValue(req, "library_session");
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const id = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = Buffer.from(signSession(id));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return queryOne(`
    SELECT users.id, users.name, users.email, users.\`role\` AS role, sessions.id AS session_id
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > ?
  `, [id, Math.floor(Date.now() / 1000)]);
}

async function requireAuth(req, res, next) {
  try {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin) return res.status(403).json({ error: "A same-origin request is required." });
  try {
    if (new URL(origin).host !== req.get("host")) {
      return res.status(403).json({ error: "Cross-origin requests are not allowed." });
    }
  } catch {
    return res.status(403).json({ error: "Invalid request origin." });
  }
  next();
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

async function availableCopies(bookId, connection = pool) {
  const book = await queryOne(`
    SELECT books.total_copies - COUNT(loans.id) AS available
    FROM books
    LEFT JOIN loans ON loans.book_id = books.id
      AND loans.status IN ('approved', 'return_requested')
    WHERE books.id = ?
    GROUP BY books.id
  `, [bookId], connection);
  return book ? Number(book.available) : null;
}

async function publicBook(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    category: book.category,
    description: book.description,
    totalCopies: book.total_copies,
    availableCopies: await availableCopies(book.id)
  };
}

async function createSession(userId, res) {
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetime;
  await execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)", [id, userId, expiresAt]);
  setSessionCookie(res, id);
}

async function createPickupCode(loanId, connection) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await execute("INSERT INTO pickup_codes (loan_id, code) VALUES (?, ?)", [loanId, code], connection);
      return code;
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
      const existing = await queryOne("SELECT code FROM pickup_codes WHERE loan_id = ?", [loanId], connection);
      if (existing) return existing.code;
      if (attempt === 9) throw error;
    }
  }
  throw new Error("Could not assign a pickup code.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.method !== "GET" && req.method !== "HEAD" && req.path.startsWith("/api/")) {
    return requireSameOrigin(req, res, next);
  }
  next();
});

app.get("/api/session", async (req, res) => {
  const user = await sessionUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!validText(name, 80) || !validText(email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Enter a valid name and email address." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: "Choose a password with at least 8 characters." });
  }
  try {
    const result = await execute(`
      INSERT INTO users (name, email, \`role\`, password_hash)
      VALUES (?, ?, 'student', ?)
    `, [name.trim(), email.trim().toLowerCase(), hashPassword(password)]);
    await createSession(result.insertId, res);
    res.status(201).json({
      user: { id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: "student" }
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account with that email already exists." });
    throw error;
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  const user = await queryOne(
    "SELECT id, name, email, `role` AS role, password_hash FROM users WHERE email = ?",
    [email.trim().toLowerCase()]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  await createSession(user.id, res);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/auth/logout", async (req, res) => {
  const user = await sessionUser(req);
  if (user) await execute("DELETE FROM sessions WHERE id = ?", [user.session_id]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/books", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 60) : "";
  const filters = [];
  const values = [];
  if (search) {
    filters.push("(title LIKE ? OR author LIKE ? OR category LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    filters.push("category = ?");
    values.push(category);
  }
  const books = await queryAll(`
    SELECT books.* FROM books
    WHERE NOT EXISTS (SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id)
    ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
    ORDER BY title
  `, values);
  res.json({
    books: await Promise.all(books.map(publicBook)),
    categories: (await queryAll(`
      SELECT DISTINCT books.category FROM books
      WHERE NOT EXISTS (SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id)
      ORDER BY books.category
    `)).map((row) => row.category)
  });
});

app.get("/api/loans", requireAuth, async (req, res) => {
  const filter = req.user.role === "manager"
    ? ""
    : "WHERE loans.student_id = ? AND loans.status <> 'returned'";
  const values = req.user.role === "manager" ? [] : [req.user.id];
  const loansWithoutCodes = await queryAll(`
    SELECT loans.id FROM loans
    LEFT JOIN pickup_codes ON pickup_codes.loan_id = loans.id
    ${filter ? `${filter} AND` : "WHERE"} pickup_codes.loan_id IS NULL
  `, values);
  for (const loan of loansWithoutCodes) {
    await createPickupCode(loan.id, pool);
  }
  const loans = await queryAll(`
    SELECT loans.*, pickup_codes.code AS pickup_code, books.title, books.author,
      users.name AS student_name, users.email AS student_email
    FROM loans JOIN books ON books.id = loans.book_id
    JOIN users ON users.id = loans.student_id
    LEFT JOIN pickup_codes ON pickup_codes.loan_id = loans.id
    ${filter}
    ORDER BY loans.requested_at DESC, loans.id DESC
  `, values);
  res.json({ loans: loans.map((loan) => ({
    id: loan.id, studentId: loan.student_id, studentName: loan.student_name, studentEmail: loan.student_email,
    bookId: loan.book_id, title: loan.title, author: loan.author, status: loan.status,
    pickupCode: loan.pickup_code, requestedAt: loan.requested_at, dueAt: loan.due_at, returnedAt: loan.returned_at
  })) });
});

app.post("/api/loans", requireAuth, requireRole("student"), async (req, res) => {
  const bookId = Number(req.body?.bookId);
  if (!Number.isSafeInteger(bookId) || bookId < 1) return res.status(400).json({ error: "Choose a valid book." });
  const result = await withTransaction(async (connection) => {
    const book = await queryOne(`
      SELECT books.id FROM books
      WHERE books.id = ? AND NOT EXISTS (
        SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id
      ) FOR UPDATE
    `, [bookId], connection);
    if (!book) return { error: "That book could not be found.", status: 404 };
    const available = await availableCopies(bookId, connection);
    if (available < 1) return { error: "This book is currently unavailable.", status: 409 };
    const existing = await queryOne(`
      SELECT id FROM loans
      WHERE student_id = ? AND book_id = ? AND status IN ('pending', 'approved', 'return_requested')
    `, [req.user.id, bookId], connection);
    if (existing) return { error: "You already have an active request or loan for this book.", status: 409 };
    const loan = await execute(
      "INSERT INTO loans (student_id, book_id, status) VALUES (?, ?, 'pending')",
      [req.user.id, bookId],
      connection
    );
    const pickupCode = await createPickupCode(loan.insertId, connection);
    return { id: loan.insertId, pickupCode };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(201).json({
    loanId: result.id,
    pickupCode: result.pickupCode,
    message: "Your request is with the library manager. Keep your pickup code for collection."
  });
});

app.post("/api/loans/:id/return", requireAuth, requireRole("student"), async (req, res) => {
  const loanId = Number(req.params.id);
  if (!Number.isSafeInteger(loanId) || loanId < 1) return res.status(400).json({ error: "Choose a valid loan." });
  const result = await execute(`
    UPDATE loans SET status = 'return_requested'
    WHERE id = ? AND student_id = ? AND status = 'approved'
  `, [loanId, req.user.id]);
  if (!result.affectedRows) return res.status(409).json({ error: "This loan cannot be returned right now." });
  res.json({ ok: true, message: "Your return request has been sent to the library manager." });
});

app.get("/api/manager/summary", requireAuth, requireRole("manager"), async (req, res) => {
  const [books, students, pending, active] = await Promise.all([
    queryOne(`
      SELECT COUNT(*) AS count, COALESCE(SUM(books.total_copies), 0) AS copies FROM books
      WHERE NOT EXISTS (SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id)
    `),
    queryOne("SELECT COUNT(*) AS count FROM users WHERE `role` = 'student'"),
    queryOne("SELECT COUNT(*) AS count FROM loans WHERE status = 'pending'"),
    queryOne("SELECT COUNT(*) AS count FROM loans WHERE status IN ('approved', 'return_requested')")
  ]);
  res.json({ books: books.count, copies: books.copies, students: students.count, pending: pending.count, active: active.count });
});

app.post("/api/manager/pickup-check", requireAuth, requireRole("manager"), async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a valid six-digit pickup code." });
  const loan = await queryOne(`
    SELECT loans.id, loans.status, loans.due_at, pickup_codes.code AS pickup_code,
      books.title, books.author, users.name AS student_name, users.email AS student_email
    FROM pickup_codes
    JOIN loans ON loans.id = pickup_codes.loan_id
    JOIN books ON books.id = loans.book_id
    JOIN users ON users.id = loans.student_id
    WHERE pickup_codes.code = ?
  `, [code]);
  if (!loan) return res.status(404).json({ error: "No request was found for that pickup code." });
  res.json({
    loanId: loan.id,
    code: loan.pickup_code,
    status: loan.status,
    dueAt: loan.due_at,
    title: loan.title,
    author: loan.author,
    studentName: loan.student_name,
    studentEmail: loan.student_email,
    canCollect: loan.status === "approved"
  });
});

app.post("/api/manager/books", requireAuth, requireRole("manager"), async (req, res) => {
  const { title, author, isbn = "", category = "General", description = "", totalCopies } = req.body || {};
  if (!validText(title, 160) || !validText(author, 120) || !validText(category, 60) ||
      typeof isbn !== "string" || isbn.length > 32 || typeof description !== "string" || description.length > 500 ||
      !Number.isSafeInteger(totalCopies) || totalCopies < 0 || totalCopies > 10000) {
    return res.status(400).json({ error: "Check the book details and copy count, then try again." });
  }
  const result = await execute(`
    INSERT INTO books (title, author, isbn, category, description, total_copies)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [title.trim(), author.trim(), isbn.trim(), category.trim(), description.trim(), totalCopies]);
  res.status(201).json({ book: await publicBook(await queryOne("SELECT * FROM books WHERE id = ?", [result.insertId])) });
});

app.patch("/api/manager/books/:id", requireAuth, requireRole("manager"), async (req, res) => {
  const bookId = Number(req.params.id);
  const { title, author, isbn = "", category = "General", description = "", totalCopies } = req.body || {};
  if (!Number.isSafeInteger(bookId) || bookId < 1 || !validText(title, 160) || !validText(author, 120) ||
      !validText(category, 60) || typeof isbn !== "string" || isbn.length > 32 ||
      typeof description !== "string" || description.length > 500 ||
      !Number.isSafeInteger(totalCopies) || totalCopies < 0 || totalCopies > 10000) {
    return res.status(400).json({ error: "Check the book details and copy count, then try again." });
  }
  const result = await withTransaction(async (connection) => {
    const book = await queryOne(`
      SELECT books.id FROM books
      WHERE books.id = ? AND NOT EXISTS (
        SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id
      ) FOR UPDATE
    `, [bookId], connection);
    if (!book) return { missing: true };
    const active = await queryOne(
      "SELECT COUNT(*) AS count FROM loans WHERE book_id = ? AND status IN ('approved', 'return_requested')",
      [bookId],
      connection
    );
    if (Number(active.count) > totalCopies) return { conflict: true };
    await execute(`
      UPDATE books SET title = ?, author = ?, isbn = ?, category = ?, description = ?, total_copies = ?
      WHERE id = ?
    `, [title.trim(), author.trim(), isbn.trim(), category.trim(), description.trim(), totalCopies, bookId], connection);
    return { book: await queryOne("SELECT * FROM books WHERE id = ?", [bookId], connection) };
  });
  if (result.missing) return res.status(404).json({ error: "That book could not be found." });
  if (result.conflict) return res.status(409).json({ error: "Copies cannot be fewer than the number currently borrowed." });
  res.json({ book: await publicBook(result.book) });
});

app.delete("/api/manager/books/:id", requireAuth, requireRole("manager"), async (req, res) => {
  const bookId = Number(req.params.id);
  if (!Number.isSafeInteger(bookId) || bookId < 1) return res.status(400).json({ error: "Choose a valid book." });
  const result = await withTransaction(async (connection) => {
    const book = await queryOne(`
      SELECT books.id FROM books
      WHERE books.id = ? AND NOT EXISTS (
        SELECT 1 FROM archived_books WHERE archived_books.book_id = books.id
      ) FOR UPDATE
    `, [bookId], connection);
    if (!book) return { missing: true };
    const active = await queryOne(
      "SELECT COUNT(*) AS count FROM loans WHERE book_id = ? AND status IN ('pending', 'approved', 'return_requested')",
      [bookId],
      connection
    );
    if (Number(active.count)) return { conflict: true };
    const history = await queryOne("SELECT COUNT(*) AS count FROM loans WHERE book_id = ?", [bookId], connection);
    if (Number(history.count)) {
      await execute("INSERT INTO archived_books (book_id) VALUES (?)", [bookId], connection);
      return { ok: true, archived: true };
    }
    await execute("DELETE FROM books WHERE id = ?", [bookId], connection);
    return { ok: true };
  });
  if (result.missing) return res.status(404).json({ error: "That book could not be found." });
  if (result.conflict) return res.status(409).json({ error: "Resolve pending requests and active loans before removing this book." });
  res.json({ ok: true });
});

app.patch("/api/manager/loans/:id", requireAuth, requireRole("manager"), async (req, res) => {
  const loanId = Number(req.params.id);
  const action = req.body?.action;
  if (!Number.isSafeInteger(loanId) || loanId < 1 || !["approve", "reject", "mark_returned"].includes(action)) {
    return res.status(400).json({ error: "Choose a valid request action." });
  }
  const dueDate = req.body?.dueDate;
  if (action === "approve") {
    const parsedDate = typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? new Date(`${dueDate}T00:00:00Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dueDate ||
        dueDate < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: "Choose a valid due date that is today or later." });
    }
  }
  const result = await withTransaction(async (connection) => {
    const initialLoan = await queryOne("SELECT id, book_id FROM loans WHERE id = ?", [loanId], connection);
    if (!initialLoan) return { error: "That request could not be found.", status: 404 };
    if (action === "approve") {
      const book = await queryOne("SELECT id FROM books WHERE id = ? FOR UPDATE", [initialLoan.book_id], connection);
      if (!book) return { error: "That book could not be found.", status: 404 };
    }
    const loan = await queryOne("SELECT * FROM loans WHERE id = ? FOR UPDATE", [loanId], connection);
    if (action === "approve") {
      if (loan.status !== "pending") return { error: "Only pending requests can be approved.", status: 409 };
      if (await availableCopies(loan.book_id, connection) < 1) return { error: "No copies are currently available.", status: 409 };
      const dueAt = `${dueDate} 23:59:59`;
      await execute("UPDATE loans SET status = 'approved', due_at = ? WHERE id = ?", [dueAt, loanId], connection);
      return { ok: true, message: `Request approved. The book is due by ${dueDate}.` };
    }
    if (action === "reject") {
      if (loan.status !== "pending") return { error: "Only pending requests can be rejected.", status: 409 };
      await execute("UPDATE loans SET status = 'rejected' WHERE id = ?", [loanId], connection);
      return { ok: true, message: "Request declined." };
    }
    if (loan.status !== "return_requested" && loan.status !== "approved") {
      return { error: "Only active loans can be marked returned.", status: 409 };
    }
    await execute("UPDATE loans SET status = 'returned', returned_at = CURRENT_TIMESTAMP WHERE id = ?", [loanId], connection);
    return { ok: true, message: "Book marked as returned." };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.use(express.static(path.join(__dirname, "public")));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function start() {
  await initializeDatabase();
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const existingManager = await queryOne("SELECT id FROM users WHERE `role` = 'manager' LIMIT 1");
  if (adminEmail && adminPassword && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) && adminPassword.length >= 12) {
    if (!existingManager) {
      await execute("INSERT INTO users (name, email, `role`, password_hash) VALUES (?, ?, 'manager', ?)", [
        "Library Manager", adminEmail.trim().toLowerCase(), hashPassword(adminPassword)
      ]);
      console.log(`Created initial library manager account for ${adminEmail.trim().toLowerCase()}.`);
    }
  } else if (!existingManager) {
    console.warn("No library manager exists. Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters to create one.");
  }
  const server = app.listen(port, () => {
    const address = server.address();
    const listeningPort = address && typeof address === "object" ? address.port : port;
    console.log(`Library app is running at http://localhost:${listeningPort}`);
  });
}

start().catch(async (error) => {
  console.error("Library app failed to start:", error);
  await pool.end();
  process.exitCode = 1;
});
