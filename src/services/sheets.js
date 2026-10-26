import { google } from 'googleapis';
import fs from 'fs';
import { config } from '../config.js';

export class SheetsService {
  constructor() {
    this.spreadsheetId = config.spreadsheetId;
    this.sheetName = config.sheetName;
    this.auth = null;
    this.sheets = null;
    this.isInitialized = false;
  }

  _getAuth() {
    if (this.auth) return this.auth;

    if (config.serviceAccountJson) {
      try {
        const credentials = JSON.parse(config.serviceAccountJson);
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
      } catch (err) {
        throw new Error(`Gagal parse GOOGLE_SERVICE_ACCOUNT_JSON: ${err.message}`);
      }
    } else if (config.serviceAccountKeyFile && fs.existsSync(config.serviceAccountKeyFile)) {
      this.auth = new google.auth.GoogleAuth({
        keyFile: config.serviceAccountKeyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      throw new Error(
        `File kredensial Service Account tidak ditemukan di: ${config.serviceAccountKeyFile}. Pastikan file sudah ada atau set GOOGLE_SERVICE_ACCOUNT_JSON.`
      );
    }

    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    return this.auth;
  }

  /**
   * Pastikan sheet dan header tabel sudah siap
   */
  async ensureSheetReady() {
    this._getAuth();
    if (this.isInitialized) return;

    try {
      const metadata = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheetExists = metadata.data.sheets?.some(
        s => s.properties?.title === this.sheetName
      );

      // Jika tab sheet belum ada, buat tab baru
      if (!sheetExists) {
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.sheetName,
                  },
                },
              },
            ],
          },
        });
      }

      // Cek apakah baris header sudah ada di baris 1
      const headerCheck = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:H1`,
      });

      const headers = [
        'Tanggal',
        'Waktu',
        'Nominal (Rp)',
        'Kategori',
        'Keterangan',
        'Catatan Tambahan',
        'Sumber Input',
        'Pengirim',
      ];

      if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${this.sheetName}!A1:H1`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [headers],
          },
        });
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('Error saat memastikan Google Sheet siap:', error.message);
      throw error;
    }
  }

  /**
   * Menambahkan baris pengeluaran baru ke Google Sheet
   * @param {Array<Array<any>>} rows - Array of row data
   */
  async appendExpenses(rows) {
    await this.ensureSheetReady();

    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A:H`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: rows,
      },
    });

    return response.data;
  }
}

export const sheetsService = new SheetsService();
