# Booknook school library

A full-stack library app for students and library managers. Students can browse the catalog, request available books, receive a pickup code, see approval and due dates, and ask to return a loan. Managers can review requests, verify pickup codes, set a return date when approving a request, decline requests, record returns, and maintain book listings and stock.

## Requirements

- Node.js 20+
- npm
- MySQL 8+ or a compatible MySQL server

## Configure and run

Create a MySQL database and a dedicated application user. For a local MySQL installation, an administrator can run:

```sql
CREATE DATABASE library_school CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'library_app'@'127.0.0.1' IDENTIFIED BY 'use-a-unique-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES ON library_school.* TO 'library_app'@'localhost';
```

Install dependencies and configure the app:

```sh
npm install
cp .env.example .env
```

Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` in `.env` to match your MySQL server. For a managed MySQL service that requires TLS, set `MYSQL_SSL_CA` to its CA certificate path. The app creates its tables and starter catalog when it starts; the database itself must already exist.

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to provision the initial manager account. The initial manager password must be at least 12 characters. The first manager is created when the app starts; subsequent restarts do not reset its password. Set a long, unique `SESSION_SECRET` before deploying.

Start the app:

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Student accounts can be created from the sign-in screen; public registration always assigns the student role. Set `PORT` to change the listening port.

## Migrate existing SQLite data

Run the migration **before the first app start** so its starter catalog does not make the destination non-empty. The script copies users, books, sessions, and loans from the previous SQLite database into empty MySQL tables while preserving IDs and password hashes. It leaves the SQLite source unchanged and stops if the MySQL tables already contain data.

```sh
SQLITE_PATH=./data/library.sqlite npm run migrate:sqlite
```

Create the MySQL database and set the MySQL environment variables before running the migration. If you want existing sessions to remain valid, keep the same `SESSION_SECRET`. The app seeds any starter books that are missing after migration.

## Tests

Run `npm test` for the MySQL integration suite. To run it, set `MYSQL_TEST_DATABASE` to a short database-name prefix and use MySQL credentials with privileges to create/drop databases and create/access tables in them. Each test run creates and drops its own isolated database; it does not modify `MYSQL_DATABASE`. Without this setting the integration test is skipped.

## Roles and access

- **Students:** browse books, submit borrow requests with a pickup code, see their own loans, and request returns.
- **Library managers:** review all requests, verify pickup codes, set due dates while approving or decline requests, check in active loans, and add, edit, or remove books.
- Role checks are enforced by the server, not just by the interface. Passwords are stored as salted scrypt hashes; signed HTTP-only sessions and all library data are persisted in MySQL.
