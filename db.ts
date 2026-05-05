import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcryptjs';

const dbPath = path.resolve(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

export const initDb = () => {
  console.log('Initializing database...');
  // Branches table
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      branch_id INTEGER,
      FOREIGN KEY (branch_id) REFERENCES branches(id)
    )
  `);

  // Records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_number TEXT UNIQUE NOT NULL,
      name TEXT,
      nic TEXT,
      item_description TEXT,
      weight TEXT,
      loan_amount REAL,
      interest_rate REAL,
      status TEXT DEFAULT 'ACTIVE', -- ACTIVE, REDEEMED, OVERDUE
      branch_id INTEGER,
      created_by INTEGER,
      ticket_image_url TEXT,
      receipt_image_url TEXT,
      raw_ocr_text TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (branch_id) REFERENCES branches(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  // Seed Branches
  const branches = [
    'Colombo', 'Kandy', 'Galle', 'Jaffna', 'Negombo',
    'Kurunegala', 'Gampaha', 'Kalutara', 'Matara', 'Ratnapura', 'Anuradhapura'
  ];

  const insertBranch = db.prepare("INSERT OR IGNORE INTO branches (name) VALUES (?)");
  branches.forEach(branch => insertBranch.run(branch));

  // Seed Admin User
  const adminPassword = 'admin123';
  const hashedPassword = bcrypt.hashSync(adminPassword, 10);
  
  console.log('Checking for admin user...');
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    console.log('Seeding admin user...');
    db.prepare(`
        INSERT INTO users (username, password, role)
        VALUES (?, ?, ?)
    `).run('admin', hashedPassword, 'Admin');
  } else {
    console.log('Updating admin password to admin123...');
    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hashedPassword, 'admin');
  }

  console.log('Database initialization complete.');
  return Promise.resolve();
};

export default db;
