/**
 * Format angka ke format mata uang Rupiah
 * @param {number} amount
 * @returns {string} Contoh: "Rp 45.000"
 */
export function formatRupiah(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return 'Rp 0';
  }
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Mendapatkan tanggal hari ini dalam format YYYY-MM-DD sesuai zona waktu Asia/Jakarta (WIB)
 * @returns {string}
 */
export function getCurrentDateWIB() {
  const d = new Date();
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // en-CA gives YYYY-MM-DD
  return formatter.format(d);
}

/**
 * Mendapatkan waktu saat ini dalam format HH:mm:ss sesuai zona waktu Asia/Jakarta (WIB)
 * @returns {string}
 */
export function getCurrentTimeWIB() {
  const d = new Date();
  const options = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  return new Intl.DateTimeFormat('id-ID', options).format(d);
}
/**
 * Mendapatkan tanggal beberapa hari yang lalu dalam format YYYY-MM-DD (WIB)
 * @param {number} days
 * @returns {string}
 */
export function getPastDateWIB(days = 7) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const options = { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' };
  return new Intl.DateTimeFormat('en-CA', options).format(d);
}

/**
 * Format tanggal YYYY-MM-DD ke format Indonesia ramah dibaca (contoh: 26 Okt 2026)
 * @param {string} dateStr 
 * @returns {string}
 */
export function formatDateIndo(dateStr) {
  if (!dateStr) return '-';
  try {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/**
 * Filter daftar pengeluaran berdasarkan periode
 * @param {Array} expenses 
 * @param {'hari'|'minggu'|'bulan'|'tahun'} period 
 */
export function filterExpensesByPeriod(expenses, period = 'bulan') {
  const today = getCurrentDateWIB(); // YYYY-MM-DD
  const currentMonth = today.slice(0, 7); // YYYY-MM
  const currentYear = today.slice(0, 4); // YYYY
  const sevenDaysAgo = getPastDateWIB(6); // 7 hari termasuk hari ini

  switch (period) {
    case 'hari':
    case 'today':
      return {
        periodName: `Hari Ini (${formatDateIndo(today)})`,
        periodKey: 'hari',
        data: expenses.filter(e => e.tanggal === today),
      };

    case 'minggu':
    case 'week':
      return {
        periodName: `7 Hari Terakhir (${formatDateIndo(sevenDaysAgo)} - ${formatDateIndo(today)})`,
        periodKey: 'minggu',
        data: expenses.filter(e => e.tanggal >= sevenDaysAgo && e.tanggal <= today),
      };

    case 'bulan':
    case 'month':
      return {
        periodName: `Bulan Ini (${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date())})`,
        periodKey: 'bulan',
        data: expenses.filter(e => (e.tanggal || '').startsWith(currentMonth)),
      };

    case 'tahun':
    case 'year':
      return {
        periodName: `Tahun Ini (${currentYear})`,
        periodKey: 'tahun',
        data: expenses.filter(e => (e.tanggal || '').startsWith(currentYear)),
      };

    default:
      return {
        periodName: 'Semua Waktu',
        periodKey: 'semua',
        data: expenses,
      };
  }
}

/**
 * Menghitung ringkasan statistik dari array pengeluaran
 * @param {Array} expenses 
 */
export function calculateExpenseStats(expenses) {
  let total = 0;
  const categoryMap = {};

  expenses.forEach(item => {
    const amount = Number(item.nominal) || 0;
    total += amount;

    const cat = item.kategori || 'Lain-lain';
    if (!categoryMap[cat]) {
      categoryMap[cat] = { nominal: 0, count: 0 };
    }
    categoryMap[cat].nominal += amount;
    categoryMap[cat].count += 1;
  });

  // Urutkan kategori dari yang terbesar
  const categories = Object.entries(categoryMap)
    .map(([name, val]) => ({
      name,
      nominal: val.nominal,
      count: val.count,
      percentage: total > 0 ? ((val.nominal / total) * 100).toFixed(1) : '0',
    }))
    .sort((a, b) => b.nominal - a.nominal);

  // Cari 3 pengeluaran terbesar
  const topTransactions = [...expenses]
    .sort((a, b) => (Number(b.nominal) || 0) - (Number(a.nominal) || 0))
    .slice(0, 3);

  return {
    total,
    count: expenses.length,
    average: expenses.length > 0 ? Math.round(total / expenses.length) : 0,
    categories,
    topTransactions,
  };
}

/**
 * Membuat progress bar teks
 * @param {number} percentage 
 */
function createProgressBar(percentage) {
  const totalBars = 8;
  const filled = Math.min(totalBars, Math.max(0, Math.round((percentage / 100) * totalBars)));
  return '▓'.repeat(filled) + '░'.repeat(totalBars - filled);
}

/**
 * Format teks rekap laporan yang cantik dan informatif untuk Telegram
 * @param {string} periodName 
 * @param {Object} stats 
 */
export function formatReportText(periodName, stats) {
  if (stats.count === 0) {
    return `📊 *REKAP PENGELUARAN*\n` +
      `📅 *Periode*: ${periodName}\n\n` +
      `Belum ada data pengeluaran yang tercatat di periode ini. 🍃\n` +
      `Ketikkan pengeluaranmu (misal: \`kopi 25rb\`) untuk mulai mencatat.`;
  }

  let text = `📊 *REKAP PENGELUARAN*\n`;
  text += `📅 *Periode*: ${periodName}\n\n`;
  text += `💰 *Total Pengeluaran*: *${formatRupiah(stats.total)}*\n`;
  text += `🧾 *Jumlah Transaksi*: ${stats.count} transaksi\n`;
  text += `📈 *Rata-rata per Transaksi*: ${formatRupiah(stats.average)}\n\n`;

  text += `🏷️ *Rincian per Kategori*:\n`;
  stats.categories.forEach(cat => {
    const bar = createProgressBar(cat.percentage);
    text += `• *${cat.name}*: ${formatRupiah(cat.nominal)} (${cat.percentage}%)\n`;
    text += `  \`${bar}\` _(${cat.count}x)_\n`;
  });

  if (stats.topTransactions.length > 0) {
    text += `\n🔥 *Transaksi Terbesar*:\n`;
    stats.topTransactions.forEach((t, i) => {
      text += `${i + 1}. *${t.keterangan || '-'}* (${formatRupiah(t.nominal)}) - _${t.tanggal}_\n`;
    });
  }

  return text;
}

/**
 * Membangun ringkasan konteks data keuangan dari Google Sheets untuk dimasukkan ke AI prompt
 * @param {Array<Object>} allExpenses 
 * @returns {string}
 */
export function buildFinancialContext(allExpenses = []) {
  const today = getCurrentDateWIB();
  const currentTime = getCurrentTimeWIB();

  const todayData = filterExpensesByPeriod(allExpenses, 'hari');
  const todayStats = calculateExpenseStats(todayData.data);

  const weekData = filterExpensesByPeriod(allExpenses, 'minggu');
  const weekStats = calculateExpenseStats(weekData.data);

  const monthData = filterExpensesByPeriod(allExpenses, 'bulan');
  const monthStats = calculateExpenseStats(monthData.data);

  const yearData = filterExpensesByPeriod(allExpenses, 'tahun');
  const yearStats = calculateExpenseStats(yearData.data);

  let context = `=== DATA KEUANGAN PENGGUNA TERKINI (GOOGLE SHEETS) ===\n`;
  context += `📅 Tanggal Hari Ini: ${today} (${formatDateIndo(today)}) | Waktu Sekarang: ${currentTime} WIB\n\n`;

  context += `💰 RINGKASAN:\n`;
  context += `- Pengeluaran Hari Ini: ${formatRupiah(todayStats.total)} (${todayStats.count} transaksi)\n`;
  context += `- Pengeluaran 7 Hari Terakhir: ${formatRupiah(weekStats.total)} (${weekStats.count} transaksi)\n`;
  context += `- Pengeluaran Bulan Ini: ${formatRupiah(monthStats.total)} (${monthStats.count} transaksi, rata-rata ${formatRupiah(monthStats.average)}/trx)\n`;
  if (monthStats.categories.length > 0) {
    context += `  Distribusi Kategori Bulan Ini:\n`;
    monthStats.categories.forEach(c => {
      context += `  * ${c.name}: ${formatRupiah(c.nominal)} (${c.percentage}%, ${c.count}x)\n`;
    });
  }
  context += `- Pengeluaran Tahun Ini: ${formatRupiah(yearStats.total)} (${yearStats.count} transaksi)\n\n`;

  // Ambil hingga 40 transaksi paling baru (urutkan dari yang paling baru)
  const recentExpenses = allExpenses.slice(-40).reverse();
  context += `📋 DAFTAR ${recentExpenses.length} TRANSAKSI TERAKHIR (Gunakan nomor baris [#...] untuk referensi edit/hapus):\n`;
  if (recentExpenses.length === 0) {
    context += `(Belum ada transaksi tersimpan)\n`;
  } else {
    recentExpenses.forEach(e => {
      context += `[#${e.rowIndex}] ${e.tanggal} ${e.waktu || ''} | ${formatRupiah(e.nominal)} | Kategori: ${e.kategori} | Ket: ${e.keterangan}${e.catatan_tambahan ? ` | Catatan: ${e.catatan_tambahan}` : ''}\n`;
    });
  }

  return context;
}

/**
 * Pengelola riwayat percakapan memori per user
 */
export class ConversationManager {
  constructor(maxTurns = 10) {
    this.sessions = new Map();
    this.maxTurns = maxTurns;
  }

  getHistory(userId) {
    return this.sessions.get(String(userId)) || [];
  }

  addMessage(userId, role, content) {
    const id = String(userId);
    const msgs = this.getHistory(id);
    msgs.push({ role, content });
    // Jaga agar panjang percakapan tidak melebihi batas turns
    if (msgs.length > this.maxTurns * 2) {
      msgs.splice(0, msgs.length - this.maxTurns * 2);
    }
    this.sessions.set(id, msgs);
  }

  clear(userId) {
    this.sessions.delete(String(userId));
  }
}

export const conversationManager = new ConversationManager(10);

