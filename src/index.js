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
  buildFinancialContext,
  conversationManager,
  detectImageMimeType,
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

/**
 * Handler utama untuk memproses hasil keputusan Agent AI
 */
async function handleAgentDecision(ctx, decision, inputType, originalPrompt = '') {
  const userId = ctx.from?.id;
  const userIdentifier = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'User');
  const currentTime = getCurrentTimeWIB();

  // Simpan riwayat input user ke memori percakapan
  if (originalPrompt) {
    conversationManager.addMessage(userId, 'user', originalPrompt);
  }

  // 1. INTENT: RECORD_EXPENSE
  if (decision.intent === 'RECORD_EXPENSE' && decision.expenses && decision.expenses.length > 0) {
    const rowsToAppend = decision.expenses.map((item) => [
      item.tanggal,
      currentTime,
      item.nominal,
      item.kategori || 'Lain-lain',
      item.keterangan || '-',
      item.catatan_tambahan || '',
      inputType,
      userIdentifier,
    ]);

    await sheetsService.appendExpenses(rowsToAppend);

    let replyText = `✅ *Berhasil Dicatat ke Google Sheet!*\n\n`;
    let total = 0;

    decision.expenses.forEach((item, index) => {
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

    if (decision.expenses.length > 1) {
      replyText += `📊 *Total Pengeluaran*: *${formatRupiah(total)}*\n`;
    }

    if (decision.reply) {
      replyText += `💬 _${decision.reply}_\n`;
    }

    await ctx.reply(replyText, { parse_mode: 'Markdown' });
    conversationManager.addMessage(userId, 'assistant', replyText);
    return;
  }

  // 2. INTENT: EDIT_EXPENSE
  if (decision.intent === 'EDIT_EXPENSE' && decision.edit && decision.edit.rowIndex) {
    const rowIndex = Number(decision.edit.rowIndex);
    const existingItem = await sheetsService.getExpenseByRow(rowIndex);

    await sheetsService.updateExpenseRow(rowIndex, {
      tanggal: decision.edit.tanggal || existingItem.tanggal,
      waktu: existingItem.waktu,
      nominal: Number(decision.edit.nominal) || existingItem.nominal,
      kategori: decision.edit.kategori || existingItem.kategori,
      keterangan: decision.edit.keterangan || existingItem.keterangan,
      catatan_tambahan: decision.edit.catatan_tambahan !== undefined ? decision.edit.catatan_tambahan : existingItem.catatan_tambahan,
      sumber: 'Edit AI',
      pengirim: userIdentifier,
    });

    let editReply = decision.reply;
    if (!editReply) {
      editReply = `✏️ *Transaksi Baris #${rowIndex} Berhasil Diperbarui!*\n\n` +
        `• Tanggal: ${decision.edit.tanggal || existingItem.tanggal}\n` +
        `• Keterangan: ${decision.edit.keterangan || existingItem.keterangan}\n` +
        `• Nominal: *${formatRupiah(decision.edit.nominal || existingItem.nominal)}*\n` +
        `• Kategori: ${decision.edit.kategori || existingItem.kategori}`;
    }

    await ctx.reply(editReply, { parse_mode: 'Markdown' });
    conversationManager.addMessage(userId, 'assistant', editReply);
    return;
  }

  // 3. INTENT: DELETE_EXPENSE
  if (decision.intent === 'DELETE_EXPENSE' && decision.deleteRowIndex) {
    const rowIndex = Number(decision.deleteRowIndex);
    const itemToDelete = await sheetsService.getExpenseByRow(rowIndex);
    await sheetsService.deleteExpenseRow(rowIndex);

    let delReply = decision.reply;
    if (!delReply) {
      delReply = `🗑️ *Transaksi Baris #${rowIndex} Berhasil Dihapus!*\n` +
        `• ${itemToDelete.keterangan} (${formatRupiah(itemToDelete.nominal)})`;
    }

    await ctx.reply(delReply, { parse_mode: 'Markdown' });
    conversationManager.addMessage(userId, 'assistant', delReply);
    return;
  }

  // 4. INTENT: CHAT_QUERY (Tanya jawab, diskusi keuangan, analisa, saran)
  const chatReply = decision.reply || 'Saya telah memahami pesanmu. Ada yang ingin kamu diskusikan lagi seputar keuanganmu?';
  await ctx.reply(chatReply, { parse_mode: 'Markdown' });
  conversationManager.addMessage(userId, 'assistant', chatReply);
}

// Command: /start
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'teman';
  const text = `Halo, ${name}! 👋\n` +
    `Saya adalah **Finny**, asisten AI & analis keuangan pribadi kamu yang terhubung langsung ke database Google Sheets milikmu.\n\n` +
    `💬 *Kamu Bisa Tanya Apa Saja*: \n` +
    `Cukup ajak saya ngobrol seperti teman atau konsultan keuangan:\n` +
    `• _"Berapa total saya jajan kopi minggu ini?"_\n` +
    `• _"Kemarin saya makan apa aja ya?"_\n` +
    `• _"Menurutmu apakah saya boros bulan ini?"_\n` +
    `• _"Boleh gak saya beli jam tangan 1 juta kalau lihat cashflow saya?"_\n\n` +
    `✍️ *Mencatat Pengeluaran Sangat Fleksibel*:\n` +
    `• Ketik santai: \`kopi 25rb\` atau \`beli bensin 40rb bayar qris\`\n` +
    `• Kirim foto struk belanja / bon\n` +
    `• Kirim rekaman suara (voice note)\n\n` +
    `📊 *Laporan Cepat*:\n` +
    `• /rekap : Dashboard laporan interaktif\n` +
    `• /analisa : Bedah mendalam kebiasaan belanja & skor finansial\n` +
    `• /list : Cek 10 transaksi terakhir\n` +
    `• /reset : Reset memori sesi percakapan\n\n` +
    `Ketik /help untuk panduan lengkap.`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Command: /help
bot.command('help', async (ctx) => {
  const text = `📖 *Panduan Bot AI Keuangan Nyatet*:\n\n` +
    `🤖 *1. Chatbot Finansial Pintar*:\n` +
    `Kamu bisa bertanya apa saja seputar keuanganmu tanpa format kaku. AI memiliki akses ke riwayat transaksi dan ringkasan anggaranmu.\n` +
    `Contoh:\n` +
    `• _"Berapa sisa pengeluaranku bulan ini?"_\n` +
    `• _"Kategori apa yang paling boros?"_\n` +
    `• _"Ubah pengeluaran kopi tadi jadi 28rb ya"_\n` +
    `• _"Hapus pengeluaran bensin yang tadi pagi"_\n\n` +
    `🎙️ *2. Voice Note (Suara)*:\n` +
    `Kirim rekaman suara apa saja! AI akan mendengarkan, mentranskripsinya, lalu mencatat atau menjawab pertanyaanmu.\n\n` +
    `📸 *3. Foto & Struk*:\n` +
    `Kirim struk belanja untuk langsung dicatat, atau kirim foto barang dengan pertanyaan (misal: _"kira-kira aman ga beli ini sekarang?"_).\n\n` +
    `📊 *4. Perintah Tambahan*:\n` +
    `• /rekap : Laporan harian, 7 hari, bulanan, tahunan\n` +
    `• /analisa : Analisa mendalam & saran penghematan konkret\n` +
    `• /list : Daftar transaksi terakhir (dengan ID [#...])\n` +
    `• /hapus \`<no>\` : Hapus baris transaksi\n` +
    `• /edit \`<no> <perubahan>\` : Edit baris transaksi\n` +
    `• /reset : Mulai percakapan baru (bersihkan memori sesi)`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Command: /reset
bot.command('reset', async (ctx) => {
  conversationManager.clear(ctx.from?.id);
  await ctx.reply('🧹 Memori percakapan telah dibersihkan! Kita bisa mulai obrolan baru dari awal.');
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
    text += `💡 *Untuk Hapus*: ketik \`/hapus <no_baris>\` atau minta langsung di chat (misal: *"hapus baris ${recent[0]?.rowIndex}"*)\n`;
    text += `💡 *Untuk Edit*: ketik \`/edit <no_baris> <perubahan>\` atau minta di chat`;

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
      '• `/edit 5 ganti keterangan makan bakso bayar tunai`\n\n' +
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

    const allExpenses = await sheetsService.getAllExpenses();
    const financialContext = buildFinancialContext(allExpenses);
    const history = conversationManager.getHistory(ctx.from?.id);

    const decision = await sumopodService.chatWithAgent({
      userText: `Ubah transaksi baris #${rowIndex} (${existingItem.keterangan}, Rp ${existingItem.nominal}): "${instruction}"`,
      financialContext,
      history,
    });

    await handleAgentDecision(ctx, decision, 'Edit Command', text);
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

// Handler: Pesan Teks (Percakapan Cerdas, Pencatatan, Tanya Jawab, Edit, Hapus)
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  try {
    await ctx.replyWithChatAction('typing');

    // Ambil data Google Sheets terbaru untuk konteks RAG
    const allExpenses = await sheetsService.getAllExpenses();
    const financialContext = buildFinancialContext(allExpenses);
    const history = conversationManager.getHistory(ctx.from?.id);

    // Kirim pesan ke Agent AI
    const decision = await sumopodService.chatWithAgent({
      userText: text,
      financialContext,
      history,
    });

    await handleAgentDecision(ctx, decision, 'Teks', text);
  } catch (error) {
    console.error('Error saat memproses pesan teks:', error);
    await ctx.reply(`⚠️ Terjadi kesalahan saat memproses pesan: ${error.message}`);
  }
});

/**
 * Helper untuk memproses input gambar (baik dari photo terkompresi maupun document file)
 */
async function processImageMessage(ctx, fileId, caption = '') {
  try {
    await ctx.replyWithChatAction('typing');
    const statusMsg = await ctx.reply('🔎 Membaca dan menganalisis struk/gambar dengan Sumopod AI...');

    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');

    // Deteksi tipe MIME yang valid (jpeg, png, webp, gif)
    const mimeType = detectImageMimeType(file.file_path || '', buffer);

    // Ambil konteks finansial terkini
    const allExpenses = await sheetsService.getAllExpenses();
    const financialContext = buildFinancialContext(allExpenses);
    const history = conversationManager.getHistory(ctx.from?.id);

    const decision = await sumopodService.chatWithImage({
      base64Data,
      mimeType,
      caption,
      financialContext,
      history,
    });

    try {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (_) {}

    await handleAgentDecision(ctx, decision, 'Foto', caption || '[Kirim Foto]');
  } catch (error) {
    console.error('Error saat memproses foto:', error);
    await ctx.reply(`⚠️ Gagal menganalisis gambar: ${error.message}`);
  }
}

// Handler: Foto (Struk / Bukti Bayar / Foto Barang)
bot.on('message:photo', async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  await processImageMessage(ctx, photo.file_id, ctx.message.caption || '');
});

// Handler: Dokumen Gambar (Bila user mengirim foto sebagai File tanpa kompresi)
bot.on('message:document', async (ctx) => {
  const doc = ctx.message.document;
  const isImage = (doc.mime_type && doc.mime_type.startsWith('image/')) ||
    /\.(jpe?g|png|webp|gif)$/i.test(doc.file_name || '');

  if (isImage) {
    await processImageMessage(ctx, doc.file_id, ctx.message.caption || '');
  }
});

// Handler: Voice Note / Audio (Mendengarkan, Mentranskripsi, dan Berkomunikasi)
bot.on(['message:voice', 'message:audio'], async (ctx) => {
  try {
    await ctx.replyWithChatAction('record_voice');
    const waitMsg = await ctx.reply('🎧 _Mendengarkan voice note kamu..._', { parse_mode: 'Markdown' });

    const audioObj = ctx.message.voice || ctx.message.audio;
    const mimeType = audioObj.mime_type || 'audio/ogg';
    const file = await ctx.api.getFile(audioObj.file_id);

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    // 1. Transkripsi suara dengan Whisper
    const transcript = await sumopodService.transcribeAudio(base64Data, mimeType);

    if (!transcript || transcript.trim().length === 0) {
      return ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        '⚠️ Suara pada voice note tidak terdengar jelas. Coba kirimkan kembali atau gunakan pesan teks ya.'
      );
    }

    // Tampilkan transkrip kepada user agar user tahu suara terdengar akurat
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `🎙️ *Kamu berkata*: _"${transcript}"_\n_Sedang diproses..._`,
      { parse_mode: 'Markdown' }
    );

    // 2. Kirim transkrip ke AI Agent bersama konteks data keuangan
    const allExpenses = await sheetsService.getAllExpenses();
    const financialContext = buildFinancialContext(allExpenses);
    const history = conversationManager.getHistory(ctx.from?.id);

    const decision = await sumopodService.chatWithAgent({
      userText: transcript,
      financialContext,
      history,
    });

    await handleAgentDecision(ctx, decision, 'Voice Note', transcript);
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
