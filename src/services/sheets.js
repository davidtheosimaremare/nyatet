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

  /**
   * Mengambil numeric sheet ID (gid) dari tab sheet aktif
   */
  async getSheetId() {
    await this.ensureSheetReady();
    const metadata = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });
    const sheet = metadata.data.sheets?.find(s => s.properties?.title === this.sheetName);
    if (!sheet) {
      throw new Error(`Tab sheet "${this.sheetName}" tidak ditemukan di spreadsheet.`);
    }
    return sheet.properties.sheetId;
  }

  /**
   * Mengambil semua daftar pengeluaran dari Google Sheet (mulai baris 2)
   * @returns {Promise<Array<Object>>}
   */
  async getAllExpenses() {
    await this.ensureSheetReady();

    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A2:H`,
    });

    const rows = response.data.values || [];
    return rows.map((row, index) => {
      // Clean string nominal jika ada format teks Rp / titik
      const rawNominal = String(row[2] || '0').replace(/[^0-9.-]+/g, '');
      const nominal = Number(rawNominal) || 0;

      return {
        rowIndex: index + 2, // Baris 1 adalah header, jadi data mulai baris 2
        tanggal: row[0] || '',
        waktu: row[1] || '',
        nominal,
        kategori: row[3] || 'Lain-lain',
        keterangan: row[4] || '-',
        catatan_tambahan: row[5] || '',
        sumber: row[6] || '',
        pengirim: row[7] || '',
      };
    });
  }

  /**
   * Mengambil satu transaksi berdasarkan nomor baris di sheet
   * @param {number} rowIndex 
   */
  async getExpenseByRow(rowIndex) {
    if (rowIndex < 2) {
      throw new Error('Nomor baris tidak valid (baris 1 adalah header).');
    }
    const all = await this.getAllExpenses();
    const found = all.find(item => item.rowIndex === rowIndex);
    if (!found) {
      throw new Error(`Transaksi pada baris #${rowIndex} tidak ditemukan.`);
    }
    return found;
  }

  /**
   * Menghapus baris pengeluaran tertentu dari Google Sheet
   * @param {number} rowIndex
   */
  async deleteExpenseRow(rowIndex) {
    if (rowIndex < 2) {
      throw new Error('Tidak dapat menghapus baris header (baris 1).');
    }
    await this.ensureSheetReady();
    const sheetId = await this.getSheetId();

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1, // 0-indexed, inclusive
                endIndex: rowIndex, // exclusive
              },
            },
          },
        ],
      },
    });

    return true;
  }

  /**
   * Mengupdate baris pengeluaran di Google Sheet
   * @param {number} rowIndex 
   * @param {Object} updatedData 
   */
  async updateExpenseRow(rowIndex, updatedData) {
    if (rowIndex < 2) {
      throw new Error('Tidak dapat mengedit baris header (baris 1).');
    }
    await this.ensureSheetReady();

    const rowValues = [
      updatedData.tanggal,
      updatedData.waktu || '',
      updatedData.nominal,
      updatedData.kategori || 'Lain-lain',
      updatedData.keterangan || '-',
      updatedData.catatan_tambahan || '',
      updatedData.sumber || 'Edit',
      updatedData.pengirim || '',
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A${rowIndex}:H${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowValues],
      },
    });

    return true;
  }
}

export const sheetsService = new SheetsService();
