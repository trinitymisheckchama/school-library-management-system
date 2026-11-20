require("dotenv").config();

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const path = require("node:path");
const { after, before, test } = require("node:test");

const managerEmail = "manager@example.test";
const managerPassword = "manager-test-passphrase";
const testDatabasePrefix = process.env.MYSQL_TEST_DATABASE;
let adminConnection;
let databaseName;
let server;
let baseUrl;
let serverOutput = "";

async function call(endpoint, { method = "GET", body, cookie, origin = baseUrl } = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      ...(method !== "GET" ? { Origin: origin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0]
  };
}

if (!testDatabasePrefix) {
  test("students borrow books while managers control the catalog and requests", {
    skip: "Set MYSQL_TEST_DATABASE to a disposable database name prefix to run MySQL integration tests."
  }, () => {});
} else {
  before(async () => {
    if (!/^[A-Za-z0-9_]{1,35}$/.test(testDatabasePrefix)) {
      throw new Error("MYSQL_TEST_DATABASE must be 1-35 letters, numbers, or underscores.");
    }
    const connectionOptions = {
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER || "libraryUser",
      password: process.env.MYSQL_PASSWORD || "",
      ...(process.env.MYSQL_SSL_CA
        ? { ssl: { ca: require("node:fs").readFileSync(process.env.MYSQL_SSL_CA, "utf8") } }
        : {})
    };
    adminConnection = await mysql.createConnection(connectionOptions);
    databaseName = `${testDatabasePrefix}_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
    await adminConnection.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        ADMIN_EMAIL: managerEmail,
        ADMIN_PASSWORD: managerPassword,
        MYSQL_DATABASE: databaseName,
        PORT: "0",
        SESSION_SECRET: "test-session-secret-that-is-long-enough"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`App did not start. Output: ${serverOutput}`)), 15000);
      server.stdout.on("data", (chunk) => {
        serverOutput += chunk.toString();
        const match = serverOutput.match(/running at http:\/\/localhost:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
      server.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      server.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`App exited before starting (${code}). Output: ${serverOutput}`));
      });
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server && server.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
    if (adminConnection) {
      try {
        if (databaseName) {
          await adminConnection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        }
      } finally {
        await adminConnection.end();
      }
    }
  });

  test("students borrow books while managers control the catalog and requests", async () => {
    let result = await call("/api/books");
    assert.equal(result.response.status, 200);
    assert.equal(result.data.books.length, 8);

    result = await call("/api/auth/register", {
      method: "POST",
      body: { name: "Test Student", email: "student@example.test", password: "student-test-passphrase" }
    });
    assert.equal(result.response.status, 201);
    const studentCookie = result.cookie;
    assert.ok(studentCookie);
    assert.equal((await call("/api/manager/summary", { cookie: studentCookie })).response.status, 403);
    assert.equal((await call("/api/manager/summary")).response.status, 401);
    assert.equal((await call("/api/loans", {
      method: "POST",
      body: { bookId: 1 },
      cookie: studentCookie,
      origin: "http://attacker.example"
    })).response.status, 403);

    result = await call("/api/loans", { method: "POST", body: { bookId: 1 }, cookie: studentCookie });
    assert.equal(result.response.status, 201);
    const loanId = result.data.loanId;
    assert.equal((await call("/api/loans", { method: "POST", body: { bookId: 1 }, cookie: studentCookie })).response.status, 409);

    result = await call("/api/auth/login", {
      method: "POST",
      body: { email: managerEmail, password: managerPassword }
    });
    assert.equal(result.response.status, 200);
    const managerCookie = result.cookie;
    assert.ok(managerCookie);

    result = await call(`/api/manager/loans/${loanId}`, {
      method: "PATCH",
      body: { action: "approve" },
      cookie: managerCookie
    });
    assert.equal(result.response.status, 200);

    result = await call("/api/loans", { cookie: studentCookie });
    assert.equal(result.data.loans[0].status, "approved");
    assert.ok(result.data.loans[0].dueAt);
    assert.equal((await call(`/api/loans/${loanId}/return`, {
      method: "POST",
      body: {},
      cookie: studentCookie
    })).response.status, 200);
    assert.equal((await call(`/api/manager/loans/${loanId}`, {
      method: "PATCH",
      body: { action: "mark_returned" },
      cookie: managerCookie
    })).response.status, 200);

    result = await call("/api/manager/books", {
      method: "POST",
      body: { title: "Test Title", author: "Test Author", category: "Test", totalCopies: 1 },
      cookie: managerCookie
    });
    assert.equal(result.response.status, 201);
    const bookId = result.data.book.id;
    assert.equal((await call(`/api/manager/books/${bookId}`, {
      method: "PATCH",
      body: { title: "Updated Test Title", author: "Test Author", category: "Test", totalCopies: 2 },
      cookie: managerCookie
    })).response.status, 200);
    assert.equal((await call("/api/manager/books", {
      method: "POST",
      body: { title: "Unauthorized", author: "Student", category: "Test", totalCopies: 1 },
      cookie: studentCookie
    })).response.status, 403);
    assert.equal((await call("/api/manager/books/1", {
      method: "DELETE",
      cookie: managerCookie
    })).response.status, 409);
    assert.equal((await call(`/api/manager/books/${bookId}`, {
      method: "DELETE",
      cookie: managerCookie
    })).response.status, 200);
  });
}
