const fs = require("node:fs");
const mysql = require("mysql2/promise");

if (!process.env.MYSQL_DATABASE) {
  throw new Error("MYSQL_DATABASE must name an existing MySQL database.");
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "libraryUser",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: Math.min(Math.max(Number(process.env.MYSQL_CONNECTION_LIMIT) || 10, 1), 50),
  queueLimit: 0,
  timezone: "Z",
  dateStrings: true,
  ...(process.env.MYSQL_SSL_CA
    ? { ssl: { ca: fs.readFileSync(process.env.MYSQL_SSL_CA, "utf8") } }
    : {})
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

async function initializeDatabase({ seed = true } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      \`role\` ENUM('student', 'manager') NOT NULL,
      password_hash VARCHAR(200) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(36) NOT NULL PRIMARY KEY,
      user_id INT UNSIGNED NOT NULL,
      expires_at BIGINT UNSIGNED NOT NULL,
      CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      author VARCHAR(120) NOT NULL,
      isbn VARCHAR(32) NOT NULL DEFAULT '',
      category VARCHAR(60) NOT NULL DEFAULT 'General',
      description VARCHAR(500) NOT NULL DEFAULT '',
      total_copies INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loans (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT UNSIGNED NOT NULL,
      book_id INT UNSIGNED NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'return_requested', 'returned') NOT NULL,
      requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_at DATETIME NULL,
      returned_at DATETIME NULL,
      INDEX loans_student_status (student_id, status),
      INDEX loans_book_status (book_id, status),
      CONSTRAINT loans_student_fk FOREIGN KEY (student_id) REFERENCES users(id),
      CONSTRAINT loans_book_fk FOREIGN KEY (book_id) REFERENCES books(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!seed) return;
  const books = [
    ["The Hobbit", "J.R.R. Tolkien", "9780547928227", "Fantasy", "A reluctant hobbit leaves home on an unexpected adventure.", 4],
    ["Pride and Prejudice", "Jane Austen", "9780141439518", "Classics", "A witty story of first impressions, family, and love.", 3],
    ["A Brief History of Time", "Stephen Hawking", "9780553380163", "Science", "A landmark introduction to the nature of the universe.", 2],
    ["Things Fall Apart", "Chinua Achebe", "9780385474542", "Fiction", "A classic novel about tradition and change in Nigeria.", 3],
    ["The Great Gatsby", "F. Scott Fitzgerald", "9780743273565", "Classics", "A portrait of ambition and longing in the Jazz Age.", 2],
    ["The Little Prince", "Antoine de Saint-Exupéry", "9780156012195", "Fiction", "A poetic tale about friendship, curiosity, and seeing clearly.", 2],
    ["To Kill a Mockingbird", "Harper Lee", "9780061120084", "Classics", "A coming-of-age story about empathy and justice.", 3],
    ["The Selfish Gene", "Richard Dawkins", "9780198788607", "Science", "An influential look at evolution and the gene's-eye view.", 2]
  ];

  for (const book of books) {
    const [existing] = await pool.execute("SELECT id FROM books WHERE isbn = ? AND isbn <> '' LIMIT 1", [book[2]]);
    if (!existing.length) {
      await pool.execute(
        "INSERT INTO books (title, author, isbn, category, description, total_copies) VALUES (?, ?, ?, ?, ?, ?)",
        book
      );
    }
  }
}

module.exports = { pool, initializeDatabase };
