const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { pool, initializeDatabase } = require("../database");

const sourcePath = process.env.SQLITE_PATH || path.join(__dirname, "..", "data", "library.sqlite");
const tableDefinitions = {
  users: ["id", "name", "email", "role", "password_hash", "created_at"],
  books: ["id", "title", "author", "isbn", "category", "description", "total_copies", "created_at"],
  sessions: ["id", "user_id", "expires_at"],
  loans: ["id", "student_id", "book_id", "status", "requested_at", "due_at", "returned_at"]
};

function mysqlValue(table, column, value) {
  const dateColumns = {
    users: ["created_at"],
    books: ["created_at"],
    loans: ["requested_at", "due_at", "returned_at"]
  };
  if (value === null || typeof value !== "string" || !dateColumns[table]?.includes(column) || !value.includes("T")) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date in SQLite ${table}.${column}.`);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function migrate() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite source database not found: ${sourcePath}. Set SQLITE_PATH to its location.`);
  }

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const connection = await pool.getConnection();
  try {
    await initializeDatabase({ seed: false });
    const counts = {};
    for (const table of Object.keys(tableDefinitions)) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
      counts[table] = Number(rows[0].count);
    }
    if (Object.values(counts).some((count) => count > 0)) {
      throw new Error("The MySQL tables are not empty. Migration stopped to avoid overwriting existing data.");
    }

    const rowsByTable = Object.fromEntries(
      Object.keys(tableDefinitions).map((table) => [table, source.prepare(`SELECT * FROM ${table}`).all()])
    );

    await connection.beginTransaction();
    try {
      for (const table of ["users", "books", "sessions", "loans"]) {
        const columns = tableDefinitions[table];
        const columnList = columns.map((column) => `\`${column}\``).join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const insert = `INSERT INTO \`${table}\` (${columnList}) VALUES (${placeholders})`;
        for (const row of rowsByTable[table]) {
          await connection.execute(insert, columns.map((column) => mysqlValue(table, column, row[column])));
        }
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    for (const [table, rows] of Object.entries(rowsByTable)) {
      console.log(`Migrated ${rows.length} ${table} row(s).`);
    }
    console.log("SQLite data migration complete. The SQLite source was left unchanged.");
  } finally {
    source.close();
    connection.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("SQLite-to-MySQL migration failed:", error.message);
  process.exitCode = 1;
});
