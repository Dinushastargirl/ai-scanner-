import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { createWorker } from 'tesseract.js';
import { GoogleGenAI } from '@google/genai';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from "vite";
import db, { initDb } from './db.ts';

dotenv.config();

async function startServer() {
  await initDb().catch(err => {
    console.error('DATABASE INIT FAILED:', err);
    process.exit(1);
  });

  const app = express();
  const PORT = 3000;

  // Logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Multer setup for temporary file storage
  const uploadDir = 'uploads/';
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }
  const upload = multer({ dest: uploadDir });

  // Cloudinary config
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  // JWT Secret
  const JWT_SECRET = process.env.JWT_SECRET || 'secret';

  // Middleware to verify JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.status(403).json({ error: 'Token invalid' });
      req.user = user;
      next();
    });
  };

  // --- API ROUTES ---

  // Login
  app.post('/auth/login', (req, res) => {
    console.log('Login attempt Body:', JSON.stringify(req.body));
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        console.log('Missing username or password');
        return res.status(400).json({ error: 'Username and password are required' });
      }

      const user: any = db.prepare('SELECT users.*, branches.name as branch_name FROM users LEFT JOIN branches ON users.branch_id = branches.id WHERE username = ?').get(username);
      
      if (!user) {
        console.log('User not found:', username);
        return res.status(401).json({ error: 'User not found' });
      }

      console.log('User found, verifying password...');
      const passwordMatch = bcrypt.compareSync(password, user.password);
      if (!passwordMatch) {
        console.log('Invalid password for user:', username);
        return res.status(401).json({ error: 'Invalid password' });
      }

      console.log('Login successful for user:', username);
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role, branch_id: user.branch_id, branch_name: user.branch_name }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username, role: user.role, branch_id: user.branch_id, branch_name: user.branch_name } });
    } catch (err: any) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Database error', details: err?.message || String(err) });
    }
  });

  // OCR Processing (Tesseract + Gemini)
  app.post('/api/ocr-process', upload.single('image'), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

      const worker = await createWorker('eng');
      const { data: { text } } = await worker.recognize(req.file.path);
      await worker.terminate();

      // Use Gemini for structured cleanup
      let structuredData = {
        ticket_number: '',
        name: '',
        nic: '',
        item_description: '',
        weight: '',
        loan_amount: '',
        interest_rate: '',
        type: 'TICKET'
      };

      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Extract characters from this OCR text as JSON. Fields: ticket_number, name, nic, item_description, weight, loan_amount, interest_rate. Also identify if this is a "PAWN TICKET" or a "RECEIPT" (type). OCR Text: ${text}`,
          config: { responseMimeType: 'application/json' }
        });
        
        const response = result.text;
        structuredData = { ...structuredData, ...JSON.parse(response) };
      } catch (e) {
        console.error('Gemini extraction failed:', e);
      }

      res.json({ rawText: text, structuredData });
      fs.unlinkSync(req.file.path); // Clean up
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'OCR processing failed' });
    }
  });

  // Save Record (Ticket or Receipt)
  app.post('/api/save-record', authenticateToken, upload.single('image'), async (req: any, res: any) => {
    try {
      const data = JSON.parse(req.body.recordData);
      const { ticket_number, name, nic, item_description, weight, loan_amount, interest_rate, type } = data;
      const branch_id = req.user.branch_id;
      const branch_name = req.user.branch_name || 'General';

      // Upload to Cloudinary
      let imageUrl = '';
      if (req.file) {
        console.log(`[CLOUDINARY] Starting upload for Ticket ${ticket_number}. Path: ${req.file.path}`);
        try {
          const cloudResult = await cloudinary.uploader.upload(req.file.path, {
            folder: `ai_scanner/${branch_name}/${ticket_number}`,
            resource_type: 'auto'
          });
          imageUrl = cloudResult.secure_url;
          console.log('[CLOUDINARY] Success:', imageUrl);
        } catch (uploadErr) {
          console.error('[CLOUDINARY] Upload Failed:', uploadErr);
          // Don't fail the whole request yet, but log it clearly
        } finally {
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
        }
      } else {
        console.warn(`[SERVER] No file received for Ticket ${ticket_number}`);
      }

      const raw_ocr_text = data.raw_ocr_text || '';

      if (type === 'RECEIPT') {
        const row: any = db.prepare('SELECT id FROM records WHERE ticket_number = ?').get(ticket_number);
        if (!row) {
          console.error(`[DB] Redeeming non-existent ticket: ${ticket_number}`);
          return res.status(404).json({ error: 'Original Pawn Ticket not found in database. Please scan the ticket first.' });
        }

        db.prepare('UPDATE records SET status = ?, receipt_image_url = ?, raw_ocr_text = ?, updated_at = ? WHERE ticket_number = ?')
          .run('REDEEMED', imageUrl || '', raw_ocr_text, new Date().toISOString(), ticket_number);
        
        console.log(`[DB] Ticket ${ticket_number} redeemed successfully.`);
        await syncToSheets();
        res.json({ message: 'PROCESS COMPLETE - Loan Redeemed' });
      } else {
        const row: any = db.prepare('SELECT id FROM records WHERE ticket_number = ?').get(ticket_number);
        
        if (row) {
          console.log(`[DB] Updating existing ticket: ${ticket_number}`);
          const sql = `UPDATE records SET 
                        name = ?, 
                        nic = ?, 
                        item_description = ?, 
                        weight = ?, 
                        loan_amount = ?, 
                        interest_rate = ?, 
                        raw_ocr_text = ?,
                        ticket_image_url = CASE WHEN ? != '' THEN ? ELSE ticket_image_url END,
                        updated_at = ? 
                       WHERE ticket_number = ?`;
          
          db.prepare(sql).run(
            name, nic, item_description, weight, loan_amount, interest_rate, raw_ocr_text,
            imageUrl || '', imageUrl || '', new Date().toISOString(), ticket_number
          );
          
          await syncToSheets();
          res.json({ message: 'PROCESS COMPLETE - Ticket Updated' });
        } else {
          console.log(`[DB] Creating new ticket: ${ticket_number}`);
          const sql = `INSERT INTO records (ticket_number, name, nic, item_description, weight, loan_amount, interest_rate, status, branch_id, created_by, ticket_image_url, raw_ocr_text, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          
          db.prepare(sql).run(ticket_number, name, nic, item_description, weight, loan_amount, interest_rate, 'ACTIVE', branch_id, req.user.id, imageUrl || '', raw_ocr_text, new Date().toISOString());
          
          await syncToSheets();
          res.json({ message: 'PROCESS COMPLETE - Ticket Created' });
        }
      }

      async function syncToSheets() {
          if (!process.env.GOOGLE_SHEET_ID) {
            console.log('[SHEETS] Skipping sync: GOOGLE_SHEET_ID not set');
            return;
          }
          
          console.log(`[SHEETS] Attempting sync for ${ticket_number}...`);
          try {
            const serviceAccountAuth = new JWT({
              email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
              key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
              scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
            await doc.loadInfo();
            const sheet = doc.sheetsByIndex[0];
            await sheet.addRow({
                'Branch': branch_name,
                'Receipt Number': ticket_number,
                'Name': name,
                'NIC': nic,
                'Amount': loan_amount,
                'Description': item_description,
                'Image URL': imageUrl || 'N/A',
                'Timestamp': new Date().toISOString(),
                'Status': type === 'RECEIPT' ? 'REDEEMED' : 'ACTIVE'
            });
            console.log(`[SHEETS] Sync success for ${ticket_number}`);
          } catch (e: any) { 
            console.error('[SHEETS] Sync error:', e.message); 
          }
      }
    } catch (err) {
      res.status(500).json({ error: 'System error' });
    }
  });

  // Search API
  app.get('/api/records', authenticateToken, (req: any, res) => {
    const { query, branch_id } = req.query;
    let sql = 'SELECT records.*, branches.name as branch_name FROM records JOIN branches ON records.branch_id = branches.id WHERE 1=1';
    const params: any[] = [];

    if (query) {
      sql += ' AND (ticket_number LIKE ? OR records.name LIKE ? OR nic LIKE ?)';
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (branch_id) {
      sql += ' AND records.branch_id = ?';
      params.push(branch_id);
    }
    
    if (req.user.role !== 'Admin') {
      sql += ' AND records.branch_id = ?';
      params.push(req.user.branch_id);
    }

    sql += ' ORDER BY records.id DESC LIMIT 50';

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  app.get('/api/branches', authenticateToken, (req, res) => {
    const rows = db.prepare('SELECT * FROM branches').all();
    res.json(rows);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // await initDb();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

