import { Bot, InlineKeyboard } from 'grammy';
import { config, validateConfig } from './config.js';
import { sumopodService } from './services/sumopod.js';
import { sheetsService } from './services/sheets.js';
import {
  formatRupiah,
  getCurrentTimeWIB,
  filterExpensesByPeriod,
  calculateExpenseStats,
  formatReportText,
} from './utils/helpers.js';

// Validasi environment saat startup
validateConfig();

if (!config.telegramToken) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN belum diset di .env!');
  process.exit(1);
}

const bot = new Bot(config.telegramToken);

/**
 * Middleware untuk membatasi akses hanya untuk user yang diizinkan (opsional)
 */
bot.use(async (ctx, next) => {
  const userId = String(ctx.from?.id);
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    console.warn(`[AKSES DITOLAK] User ID tidak diizinkan: ${userId} (${ctx.from?.username || 'no username'})`);
    return ctx.reply(
      `⛔ Maaf, bot ini diset khusus untuk pemilik.\n\nUser ID kamu: \`${userId}\`\nTambahkan ID ini ke \`ALLOWED_TELEGRAM_USER_IDS\` di file .env server kamu jika ini adalah bot milikmu.`,
      { parse_mode: 'Markdown' }
    );
  }
  await next();
});

// Helper: Keyboard interaktif untuk navigasi laporan periode
function createReportKeyboard(activePeriod = 'bulan') {
  return new InlineKeyboard()
    .text(activePeriod === 'hari' ? '🔘 Hari Ini' : '📅 Hari Ini', 'rep:hari')
    .text(activePeriod === 'minggu' ? '🔘 7 Hari' : '🗓️ 7 Hari', 'rep:minggu')
    .row()
    .text(activePeriod === 'bulan' ? '🔘 Bulan Ini' : '📊 Bulan Ini', 'rep:bulan')
    .text(activePeriod === 'tahun' ? '🔘 Tahun Ini' : '📆 Tahun Ini', 'rep:tahun')
    .row()
    .text('🧠 Analisa AI Mendalam', `ana:${activePeriod}`);
}

/**
 * Mengirim atau memperbarui pesan rekap laporan
 */
async function sendPeriodReport(ctx, period = 'bulan', isEdit = false) {
  try {
    const allExpenses = await sheetsService.getAllExpenses();
    const filtered = filterExpensesByPeriod(allExpenses, period);
    const stats = calculateExpenseStats(filtered.data);
    const text = formatReportText(filtered.periodName, stats);
    const keyboard = createReportKeyboard(filtered.periodKey);

    if (isEdit) {
      try {
        await ctx.editMessageText(text, {
          reply_markup: keyboard,
          parse_mode: 'Markdown',
        });
      } catch (err) {
        if (!err.message?.includes('message is not modified')) {
          throw err;
        }
      }
    } else {
      await ctx.reply(text, {
        reply_markup: keyboard,
        parse_mode: 'Markdown',
      });
    }
  } catch (error) {
    console.error(`Error saat mengambil rekap ${period}:`, error);
    await ctx.reply(`⚠️ Gagal memuat rekap laporan: ${error.message}`);
  }
}

/**
 * Menjalankan analisa mendalam AI
 */
async function runDeepAnalysis(ctx, period = 'bulan') {
  await ctx.replyWithChatAction('typing');
  const waitMsg = await ctx.reply(
    '🧠 *Sedang melakukan analisa finansial mendalam dengan Sumopod AI...*\n_Membedah pola belanja, rasio pengeluaran, dan potensi kebocoran finansial..._',
    { parse_mode: 'Markdown' }
  );

  try {
    const allExpenses = await sheetsService.getAllExpenses();
    const filtered = filterExpensesByPeriod(allExpenses, period);
    const stats = calculateExpenseStats(filtered.data);

    if (stats.count === 0) {
      return ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        `ℹ️ Belum ada transaksi tercatat untuk periode *${filtered.periodName}*. Silakan catat pengeluaran terlebih dahulu agar bisa dianalisa.`,
        { parse_mode: 'Markdown' }
      );
    }

    const analysisResult = await sumopodService.analyzeExpenses(
      filtered.data,
      filtered.periodName,
      stats
    );

    const fullResponse = `📊 *HASIL ANALISA FINANSIAL MENDALAM*\n` +
      `📅 *Periode*: ${filtered.periodName}\n` +
      `💰 *Total Pengeluaran*: ${formatRupiah(stats.total)} (${stats.count} transaksi)\n\n` +
      `${analysisResult}`;

    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      fullResponse,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Error saat deep analysis:', error);
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `⚠️ Gagal menyelesaikan analisa: ${error.message}`
    );
  }
}

// Command: /start
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'teman';
  const text = `Halo, ${name}! 👋\n` +
    `Saya adalah bot asisten pencatat & analis pengeluaran keuangan pribadi kamu.\n\n` +
    `✨ *Cara Cepat Mencatat*:\n` +
    `1. 💬 *Teks*: \`kopi kenangan 25rb\` atau \`beli bensin 40rb bayar qris\`\n` +
    `2. 📸 *Foto*: Kirimkan foto struk belanja / bon / QRIS\n` +
    `3. 🎙️ *Suara*: Kirim voice note pengeluaranmu\n\n` +
    `📊 *Laporan & Analisa*:\n` +
    `• /rekap : Menu laporan lengkap dengan tombol interaktif\n` +
    `• /hari : Laporan pengeluaran hari ini\n` +
    `• /minggu : Laporan 7 hari terakhir\n` +
    `• /bulan : Laporan bulan ini\n` +
    `• /tahun : Laporan tahun ini\n` +
    `• /analisa : Analisa AI mendalam tentang pola & kesehatan finansial\n\n` +
    `🛠️ *Kelola Data*:\n` +
    `• /list : Lihat daftar transaksi terakhir (beserta ID baris)\n` +
    `• /hapus \`<no>\` : Menghapus baris transaksi tertentu\n` +
    `• /edit \`<no> <perubahan>\` : Mengedit transaksi dengan bantuan AI\n\n` +
    `Ketik /help untuk panduan lengkap.`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Command: /help
bot.command('help', async (ctx) => {
  const text = `📖 *Panduan Lengkap Bot Nyatet*:\n\n` +
    `1️⃣ *Mencatat Pengeluaran*:\n` +
    `• Ketik bebas: \`makan siang padang 30k\` atau \`pertamax 50rb bayar bca\`\n` +
    `• Kirim foto struk belanjaan (Alfamart, Indomaret, resto, dsb)\n` +
    `• Kirim rekaman suara (voice note)\n\n` +
    `2️⃣ *Melihat Laporan (Rekap)*:\n` +
    `• /rekap : Membuka dashboard laporan interaktif\n` +
    `• /hari : Pengeluaran hari ini\n` +
    `• /minggu : Pengeluaran 7 hari terakhir\n` +
    `• /bulan : Pengeluaran bulan ini\n` +
    `• /tahun : Pengeluaran tahun ini\n\n` +
    `3️⃣ *Analisa AI Mendalam*:\n` +
    `• /analisa : Sumopod AI akan membedah pola konsumsi, kebiasaan boros, memberikan rekomendasi finansial praktis, dan skor kesehatan anggaran.\n\n` +
    `4️⃣ *Edit & Hapus Transaksi*:\n` +
    `• /list : Menampilkan 10 transaksi terakhir beserta nomor baris \`[#...]\`\n` +
    `• /hapus \`<no_baris>\` : Menghapus transaksi (contoh: \`/hapus 5\`)\n` +
    `• /edit \`<no_baris> <instruksi>\` : Mengedit transaksi dengan bahasa santai\n` +
    `  Contoh:\n` +
    `  - \`/edit 5 harusnya nominal 35rb\`\n` +
    `  - \`/edit 5 ganti keterangan makan bakso bayar tunai\`\n\n` +
    `• /myid : Cek Telegram ID kamu`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Command: /rekap dan /laporan
bot.command(['rekap', 'laporan'], async (ctx) => {
  const param = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
  if (param === 'hari' || param === 'today') return sendPeriodReport(ctx, 'hari');
  if (param === 'minggu' || param === 'week') return sendPeriodReport(ctx, 'minggu');
  if (param === 'tahun' || param === 'year') return sendPeriodReport(ctx, 'tahun');
  return sendPeriodReport(ctx, 'bulan');
});

// Shortcut commands untuk laporan
bot.command('hari', (ctx) => sendPeriodReport(ctx, 'hari'));
bot.command('minggu', (ctx) => sendPeriodReport(ctx, 'minggu'));
bot.command('bulan', (ctx) => sendPeriodReport(ctx, 'bulan'));
bot.command('tahun', (ctx) => sendPeriodReport(ctx, 'tahun'));

// Command: /analisa
bot.command('analisa', async (ctx) => {
  const param = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
  let period = 'bulan';
  if (param === 'hari') period = 'hari';
  if (param === 'minggu') period = 'minggu';
  if (param === 'tahun') period = 'tahun';
  return runDeepAnalysis(ctx, period);
});

// Callback Query: Navigasi tombol laporan
bot.callbackQuery(/^rep:(hari|minggu|bulan|tahun)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery();
    const period = ctx.match[1];
    await sendPeriodReport(ctx, period, true);
  } catch (err) {
    console.error('Callback report error:', err);
  }
});

// Callback Query: Tombol analisa AI dari laporan
bot.callbackQuery(/^ana:(hari|minggu|bulan|tahun)$/, async (ctx) => {
  try {
    await ctx.answerCallbackQuery('Memulai analisa AI...');
    const period = ctx.match[1];
    await runDeepAnalysis(ctx, period);
  } catch (err) {
    console.error('Callback analysis error:', err);
    await ctx.reply(`⚠️ Gagal melakukan analisa: ${err.message}`);
  }
});

// Command: /list
bot.command('list', async (ctx) => {
  try {
    await ctx.replyWithChatAction('typing');
    const all = await sheetsService.getAllExpenses();
    if (all.length === 0) {
      return ctx.reply('🍃 Belum ada transaksi pengeluaran yang tercatat di Google Sheet.');
    }

    const param = ctx.message.text.split(/\s+/)[1];
    const limit = Math.min(25, Math.max(1, parseInt(param) || 10));
    const recent = all.slice(-limit).reverse();

    let text = `📋 *Daftar ${recent.length} Transaksi Terakhir*:\n\n`;
    recent.forEach((item) => {
      text += `🔹 *[#${item.rowIndex}]* ${item.tanggal} • *${formatRupiah(item.nominal)}*\n`;
      text += `   🏷️ ${item.kategori} - ${item.keterangan}\n`;
      if (item.catatan_tambahan) {
        text += `   📝 Catatan: ${item.catatan_tambahan}\n`;
      }
      text += `\n`;
    });

    text += `━━━━━━━━━━━━━━━━━\n`;
    text += `💡 *Untuk Hapus*: ketik \`/hapus <no_baris>\` (contoh: \`/hapus ${recent[0]?.rowIndex}\`)\n`;
    text += `💡 *Untuk Edit*: ketik \`/edit <no_baris> <perubahan>\` (contoh: \`/edit ${recent[0]?.rowIndex} ganti nominal jadi 35rb\`)`;

    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error saat list transaksi:', error);
    await ctx.reply(`⚠️ Gagal mengambil daftar transaksi: ${error.message}`);
  }
});

// Command: /hapus <rowIndex>
bot.command('hapus', async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const rowIndex = parseInt(parts[1]);

  if (!rowIndex || isNaN(rowIndex) || rowIndex < 2) {
    return ctx.reply(
      'ℹ️ *Cara Menghapus Transaksi*:\n' +
      'Gunakan format: `/hapus <nomor_baris>`\n\n' +
      'Contoh: `/hapus 5`\n' +
      '*(Ketik /list untuk melihat nomor baris [#...])*\n',
      { parse_mode: 'Markdown' }
    );
  }

  try {
    await ctx.replyWithChatAction('typing');
    // Ambil data sebelum dihapus untuk konfirmasi
    const itemToDelete = await sheetsService.getExpenseByRow(rowIndex);
    await sheetsService.deleteExpenseRow(rowIndex);

    const reply = `🗑️ *Transaksi Berhasil Dihapus!*\n\n` +
      `• *Nomor Baris*: #${rowIndex}\n` +
      `• *Tanggal*: ${itemToDelete.tanggal}\n` +
      `• *Keterangan*: ${itemToDelete.keterangan}\n` +
      `• *Nominal*: ${formatRupiah(itemToDelete.nominal)}\n` +
      `• *Kategori*: ${itemToDelete.kategori}\n\n` +
      `_Baris telah dibersihkan langsung dari Google Sheet._`;

    await ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error saat hapus transaksi:', error);
    await ctx.reply(`⚠️ Gagal menghapus transaksi baris #${rowIndex}: ${error.message}`);
  }
});

// Command: /edit <rowIndex> <instruksi>
bot.command('edit', async (ctx) => {
  const text = ctx.message.text.trim();
  const match = text.match(/^\/edit\s+(\d+)\s+(.+)$/i);

  if (!match) {
    return ctx.reply(
      'ℹ️ *Cara Mengedit Transaksi*:\n' +
      'Gunakan format: `/edit <nomor_baris> <instruksi perubahan>`\n\n' +
      'Contoh:\n' +
      '• `/edit 5 harusnya nominal 35rb`\n' +
      '• `/edit 5 ganti keterangan makan bakso bayar tunai`\n' +
      '• `/edit 5 tanggal 2026-10-25 nominal 50000`\n\n' +
      '*(Ketik /list untuk melihat nomor baris transaksi)*',
      { parse_mode: 'Markdown' }
    );
  }

  const rowIndex = parseInt(match[1]);
  const instruction = match[2];

  if (rowIndex < 2) {
    return ctx.reply('⚠️ Nomor baris tidak valid (baris 1 adalah header tabel).');
  }

  try {
    await ctx.replyWithChatAction('typing');
    const existingItem = await sheetsService.getExpenseByRow(rowIndex);

    const statusMsg = await ctx.reply(`✍️ Menganalisis perubahan untuk baris #${rowIndex} dengan Sumopod AI...`);
    const updatedFields = await sumopodService.parseEditInstruction(existingItem, instruction);

    const userIdentifier = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
    await sheetsService.updateExpenseRow(rowIndex, {
      ...updatedFields,
      waktu: existingItem.waktu,
      sumber: 'Edit',
      pengirim: userIdentifier,
    });

    let reply = `✏️ *Transaksi Berhasil Diperbarui!* (Baris #${rowIndex})\n\n`;
    reply += `• *Tanggal*: ${updatedFields.tanggal}\n`;
    reply += `• *Keterangan*: ${updatedFields.keterangan}\n`;
    reply += `• *Nominal*: *${formatRupiah(updatedFields.nominal)}*`;
    if (Number(updatedFields.nominal) !== Number(existingItem.nominal)) {
      reply += ` _(sebelumnya ${formatRupiah(existingItem.nominal)})_`;
    }
    reply += `\n• *Kategori*: ${updatedFields.kategori}\n`;
    if (updatedFields.catatan_tambahan) {
      reply += `• *Catatan*: ${updatedFields.catatan_tambahan}\n`;
    }

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, reply, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error saat edit transaksi:', error);
    await ctx.reply(`⚠️ Gagal mengedit transaksi baris #${rowIndex}: ${error.message}`);
  }
});

// Command: /myid
bot.command('myid', async (ctx) => {
  await ctx.reply(`ID Telegram kamu: \`${ctx.from?.id}\``, { parse_mode: 'Markdown' });
});

// Command: /ping
bot.command('ping', async (ctx) => {
  await ctx.reply('🏓 Pong! Bot aktif dan siap melayani.');
});

/**
 * Helper untuk memproses hasil ekstraksi dan menyimpannya ke Google Sheets
 */
async function handleExpenseResult(ctx, result, inputType) {
  if (!result || !result.expenses || result.expenses.length === 0) {
    return ctx.reply(
      '🤔 Saya tidak menemukan informasi pengeluaran dari pesan tersebut.\n' +
      'Pastikan ada keterangan barang/jasa dan nominalnya ya (misal: "kopi 25rb").'
    );
  }

  const userIdentifier = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
  const currentTime = getCurrentTimeWIB();

  // Siapkan baris-baris untuk Google Sheets
  const rowsToAppend = result.expenses.map((item) => [
    item.tanggal,
    currentTime,
    item.nominal,
    item.kategori || 'Lain-lain',
    item.keterangan || '-',
    item.catatan_tambahan || '',
    inputType,
    userIdentifier,
  ]);

  // Simpan ke Google Sheets
  await sheetsService.appendExpenses(rowsToAppend);

  // Buat pesan balasan yang rapi dan memuaskan
  let replyText = `✅ *Berhasil Dicatat ke Google Sheet!*\n\n`;
  let total = 0;

  result.expenses.forEach((item, index) => {
    total += Number(item.nominal) || 0;
    replyText += `*${index + 1}. ${item.keterangan}*\n`;
    replyText += `   💰 Nominal: *${formatRupiah(item.nominal)}*\n`;
    replyText += `   🏷️ Kategori: ${item.kategori}\n`;
    replyText += `   📅 Tanggal: ${item.tanggal}\n`;
    if (item.catatan_tambahan) {
      replyText += `   📝 Catatan: ${item.catatan_tambahan}\n`;
    }
    replyText += `\n`;
  });

  if (result.expenses.length > 1) {
    replyText += `📊 *Total Pengeluaran*: *${formatRupiah(total)}*\n`;
  }

  if (result.ringkasan) {
    replyText += `💬 _${result.ringkasan}_\n`;
  }

  await ctx.reply(replyText, { parse_mode: 'Markdown' });
}

// Handler: Pesan Teks
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const lower = text.toLowerCase();

  // Natural language shortcut: Deteksi jika user bertanya rekap / laporan
  if (lower === 'rekap' || lower === 'laporan' || lower.startsWith('rekap ') || lower.startsWith('laporan ')) {
    if (lower.includes('hari')) return sendPeriodReport(ctx, 'hari');
    if (lower.includes('minggu') || lower.includes('7 hari')) return sendPeriodReport(ctx, 'minggu');
    if (lower.includes('tahun')) return sendPeriodReport(ctx, 'tahun');
    return sendPeriodReport(ctx, 'bulan');
  }

  // Natural language shortcut: Deteksi analisa
  if (lower.includes('analisa') || lower.includes('analisis')) {
    if (lower.includes('hari')) return runDeepAnalysis(ctx, 'hari');
    if (lower.includes('minggu')) return runDeepAnalysis(ctx, 'minggu');
    if (lower.includes('tahun')) return runDeepAnalysis(ctx, 'tahun');
    return runDeepAnalysis(ctx, 'bulan');
  }

  // Natural language shortcut: Deteksi list / daftar transaksi
  if (lower === 'list' || lower === 'daftar' || lower === 'riwayat pengeluaran') {
    return ctx.reply('Ketik /list untuk melihat daftar transaksi terakhir.');
  }

  try {
    await ctx.replyWithChatAction('typing');
    const result = await sumopodService.parseText(text);
    await handleExpenseResult(ctx, result, 'Teks');
  } catch (error) {
    console.error('Error saat memproses teks:', error);
    await ctx.reply(`⚠️ Terjadi kesalahan saat memproses data: ${error.message}`);
  }
});

// Handler: Foto (Struk / Bon)
bot.on('message:photo', async (ctx) => {
  try {
    await ctx.replyWithChatAction('typing');
    await ctx.reply('🔎 Menganalisis struk/bukti bayar dengan Sumopod AI...');

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const caption = ctx.message.caption || '';
    const result = await sumopodService.parseImage(base64Data, 'image/jpeg', caption);

    await handleExpenseResult(ctx, result, 'Foto Struk');
  } catch (error) {
    console.error('Error saat memproses foto struk:', error);
    await ctx.reply(`⚠️ Gagal menganalisis struk: ${error.message}`);
  }
});

// Handler: Voice Note
bot.on(['message:voice', 'message:audio'], async (ctx) => {
  try {
    await ctx.replyWithChatAction('record_voice');
    await ctx.reply('🎧 Mendengarkan dan mencatat voice note...');

    const audioObj = ctx.message.voice || ctx.message.audio;
    const mimeType = audioObj.mime_type || 'audio/ogg';
    const file = await ctx.api.getFile(audioObj.file_id);

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    const result = await sumopodService.parseAudio(base64Data, mimeType);

    await handleExpenseResult(ctx, result, 'Voice Note');
  } catch (error) {
    console.error('Error saat memproses voice note:', error);
    await ctx.reply(`⚠️ Gagal memproses voice note: ${error.message}`);
  }
});

// Error handling global
bot.catch((err) => {
  console.error('Terjadi error pada bot Telegram:', err);
});

// Jalankan Bot
console.log('🚀 Memulai Bot Telegram Nyatet Pengeluaran...');
bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot berhasil online sebagai @${botInfo.username}`);
  },
});
