import { Bot } from 'grammy';
import { config, validateConfig } from './config.js';
import { sumopodService } from './services/sumopod.js';
import { sheetsService } from './services/sheets.js';
import { formatRupiah, getCurrentTimeWIB } from './utils/helpers.js';

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

// Command: /start
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'teman';
  const text = `Halo, ${name}! 👋\n` +
    `Saya adalah bot pencatat pengeluaran otomatis.\n\n` +
    `Kamu bisa mencatat pengeluaran dengan 3 cara mudah:\n` +
    `1. 💬 *Teks biasa*: contoh: \`kopi kenangan 25rb\` atau \`beli bensin 40rb\`\n` +
    `2. 📸 *Foto Struk*: Kirimkan foto struk belanja / bon / bukti QRIS\n` +
    `3. 🎙️ *Voice Note*: Kirim rekaman suara, misal: _"tadi makan nasi padang 30 ribu"_\n\n` +
    `Semua data akan otomatis dianalisis oleh AI dan dicatat rapi ke Google Sheets database kamu!\n\n` +
    `Ketik /help untuk panduan lebih lengkap.`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Command: /help
bot.command('help', async (ctx) => {
  const text = `📖 *Panduan Penggunaan Bot Nyatet*:\n\n` +
    `• *Format Teks Bebas*: Bebas ketik apa saja, AI akan pintar memahaminya.\n` +
    `  Contoh:\n` +
    `  - \`Makan siang ayam geprek 22k\`\n` +
    `  - \`Isi pertalite 50.000\`\n` +
    `  - \`Beli deterjen sama sabun di indomaret 65rb\`\n\n` +
    `• *Foto Struk*: Cukup foto struk belanjaanmu dan kirim langsung ke chat ini. Kamu juga bisa menambahkan caption jika ingin memberi catatan tambahan.\n\n` +
    `• *Voice Note*: Tekan tombol rekam suara dan bicaralah santai seperti biasa.\n\n` +
    `• /myid : Mengetahui ID Telegram kamu`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
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
  // Abaikan command yang diawali slash
  if (ctx.message.text.startsWith('/')) return;

  try {
    await ctx.replyWithChatAction('typing');
    const result = await sumopodService.parseText(ctx.message.text);
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
    await ctx.reply('🔎 Menganalisis struk/bukti bayar...');

    // Ambil foto resolusi tertinggi (elemen terakhir dari array photo)
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
