import 'dotenv/config';

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  sumopodApiKey: process.env.SUMOPOD_API_KEY || '',
  sumopodBaseUrl: process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1',
  sumopodModel: process.env.SUMOPOD_MODEL || 'gpt-4o-mini',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  sheetName: process.env.GOOGLE_SHEET_NAME || 'Pengeluaran',
  serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './service-account.json',
  serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  allowedUserIds: (process.env.ALLOWED_TELEGRAM_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean),
};

export function validateConfig() {
  const missing = [];
  if (!config.telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.sumopodApiKey) missing.push('SUMOPOD_API_KEY');
  if (!config.spreadsheetId) missing.push('GOOGLE_SPREADSHEET_ID');
  if (!config.serviceAccountJson && !config.serviceAccountKeyFile) {
    missing.push('GOOGLE_SERVICE_ACCOUNT_KEY_FILE atau GOOGLE_SERVICE_ACCOUNT_JSON');
  }

  if (missing.length > 0) {
    console.warn(`[PERINGATAN] Konfigurasi environment belum lengkap: ${missing.join(', ')}`);
    console.warn('Silakan salin .env.example menjadi .env lalu isi nilai yang sesuai.');
  }
}
