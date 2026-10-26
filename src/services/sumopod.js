import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';
import { getCurrentDateWIB } from '../utils/helpers.js';

export class SumopodService {
  constructor() {
    this.client = null;
    this.modelName = config.sumopodModel;
  }

  getClient() {
    if (!this.client) {
      if (!config.sumopodApiKey) {
        throw new Error('SUMOPOD_API_KEY belum diset di file .env');
      }
      this.client = new OpenAI({
        apiKey: config.sumopodApiKey,
        baseURL: config.sumopodBaseUrl || 'https://ai.sumopod.com/v1',
      });
    }
    return this.client;
  }

  _getSystemInstruction(currentDate) {
    return `Kamu adalah asisten pencatat keuangan pribadi dalam Bahasa Indonesia.
Tugasmu adalah menganalisis input pengeluaran berupa teks, gambar struk belanja / faktur / QRIS, atau transkrip suara dalam bahasa Indonesia atau bahasa sehari-hari.

Format Kategori Utama:
- Makanan & Minuman
- Belanja Kebutuhan
- Transportasi
- Tagihan & Utilitas
- Hiburan & Liburan
- Kesehatan
- Lain-lain

Aturan Ekstraksi:
1. Tanggal: Gunakan format YYYY-MM-DD. Jika tidak disebutkan secara eksplisit, gunakan tanggal default hari ini: ${currentDate}. Jika di struk fisik ada tanggal struk yang jelas, gunakan tanggal dari struk tersebut.
2. Nominal: Nilai uang dalam Rupiah harus berupa angka bulat positif (tanpa titik/koma/simbol Rp). Contoh: "kopi 25rb" -> 25000, "bensin 40k" -> 40000.
3. Keterangan: Deskripsi singkat dan jelas apa yang dibeli.
4. Catatan Tambahan: Jika tertera metode pembayaran (cth: QRIS, BCA, Tunai) atau catatan lain, masukkan di sini.
5. Jika pesan bukan pengeluaran sama sekali (hanya menyapa 'halo', pertanyaan, dsb), kembalikan array 'expenses' yang KOSONG [].
6. Jika pada struk atau pesan terdapat beberapa transaksi pengeluaran berbeda, ekstrak semuanya ke dalam daftar expenses.

WAJIB respon HANYA dalam format JSON valid dengan struktur persis seperti berikut:
{
  "expenses": [
    {
      "tanggal": "YYYY-MM-DD",
      "nominal": 25000,
      "kategori": "Makanan & Minuman",
      "keterangan": "Kopi kenangan",
      "catatan_tambahan": "QRIS"
    }
  ],
  "ringkasan": "Pesan konfirmasi singkat dan ramah"
}`;
  }

  _cleanAndParseJson(rawText) {
    if (!rawText) return { expenses: [] };
    let clean = rawText.trim();
    // Hapus code block markdown jika ada (```json ... ```)
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(clean.trim());
    } catch (err) {
      console.error('Gagal parse JSON dari Sumopod:', clean);
      throw new Error(`Format respons model tidak valid JSON: ${err.message}`);
    }
  }

  /**
   * Parse pengeluaran dari teks
   */
  async parseText(text) {
    const currentDate = getCurrentDateWIB();
    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'system',
          content: this._getSystemInstruction(currentDate),
        },
        {
          role: 'user',
          content: `Analisis pengeluaran dari teks berikut:\n"${text}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    return this._cleanAndParseJson(content);
  }

  /**
   * Parse pengeluaran dari gambar (struk / bon / bukti bayar)
   * @param {string} base64Data
   * @param {string} mimeType
   * @param {string} [caption]
   */
  async parseImage(base64Data, mimeType = 'image/jpeg', caption = '') {
    const currentDate = getCurrentDateWIB();
    const promptText = caption
      ? `Analisis struk/bukti bayar ini. Keterangan tambahan dari user: "${caption}"`
      : 'Analisis struk/bukti bayar ini dan ekstrak total belanjaan atau item pengeluaran.';

    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'system',
          content: this._getSystemInstruction(currentDate),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    return this._cleanAndParseJson(content);
  }

  /**
   * Parse pengeluaran dari file audio / voice note
   * @param {string} base64Data
   * @param {string} mimeType
   */
  async parseAudio(base64Data, mimeType = 'audio/ogg') {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const file = await toFile(buffer, 'voice.ogg', { type: mimeType });

      // Coba transkripsi dengan model whisper di Sumopod
      const transcription = await this.getClient().audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });

      if (!transcription || !transcription.text) {
        throw new Error('Hasil transkripsi audio kosong');
      }

      // Analisis teks hasil transkripsi
      return await this.parseText(transcription.text);
    } catch (error) {
      console.error('Error saat proses audio di Sumopod:', error.message);
      throw new Error(
        `Gagal memproses voice note: ${error.message}. (Catatan: Pastikan model Whisper aktif di Sumopod jika ingin menggunakan fitur voice note, atau gunakan pesan teks/foto struk).`
      );
    }
  }

  /**
   * Analisis mendalam AI terhadap data pengeluaran (Deep Financial Analysis)
   * @param {Array} expenses
   * @param {string} periodName
   * @param {Object} stats
   * @returns {Promise<string>}
   */
  async analyzeExpenses(expenses, periodName, stats) {
    if (!expenses || expenses.length === 0) {
      return 'Belum ada data transaksi yang cukup untuk dilakukan analisa.';
    }

    // Ambil sampel transaksi representatif (maksimal 25 transaksi untuk hemat token dan fokus)
    const transactionSummary = expenses.slice(-25).map(e => 
      `- ${e.tanggal}: ${e.keterangan} (${e.kategori}) = Rp ${e.nominal} [${e.catatan_tambahan || '-'}]`
    ).join('\n');

    const categoryBreakdown = stats.categories.map(c => 
      `- ${c.name}: Rp ${c.nominal.toLocaleString('id-ID')} (${c.percentage}%, ${c.count} transaksi)`
    ).join('\n');

    const prompt = `Kamu adalah Penasihat Keuangan Pribadi (Certified Financial Planner) yang cerdas, tajam, dan solutif.
Lakukan analisa finansial mendalam terhadap catatan pengeluaran user berikut ini:

PERIODE: ${periodName}
TOTAL PENGELUARAN: Rp ${stats.total.toLocaleString('id-ID')} (${stats.count} transaksi)
RATA-RATA PER TRANSAKSI: Rp ${stats.average.toLocaleString('id-ID')}

DISTRIBUSI KATEGORI:
${categoryBreakdown}

DAFTAR TRANSAKSI:
${transactionSummary}

TUGASMU:
Berikan laporan analisis mendalam dengan format Markdown yang rapi, padat, dan mudah dibaca langsung di Telegram:

1. 💡 *Insight & Pola Belanja*: Analisa kebiasaan pengeluaran user. Di mana uang paling banyak tersedot? Apakah ada pola pengeluaran impulsif atau kebocoran halus (latte factor)?
2. ⚠️ *Titik Rawan (Red Flags)*: Kategori atau kebiasaan mana yang perlu diwaspadai sebelum menjadi beban keuangan?
3. 🎯 *Rekomendasi Aksi Konkret*: Berikan 2 - 3 tips praktis yang bisa langsung diterapkan besok/minggu depan untuk mengoptimalkan cashflow.
4. 🩺 *Skor Kesehatan Pengeluaran*: Berikan skor 1 - 10 dengan alasan singkat.

Gunakan nada bicara profesional, ramah, jujur, dan membangun. Hindari basa-basi pembuka yang panjang, langsung masuk ke intisari analisa.`;

    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah perencana keuangan ahli yang menganalisa data pengeluaran dengan bahasa Indonesia yang natural, lugas, dan actionable.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    });

    return response.choices?.[0]?.message?.content || 'Gagal menghasilkan analisis finansial.';
  }

  /**
   * Membantu memetakan instruksi edit dari user ke data pengeluaran yang sudah ada
   * @param {Object} existingExpense 
   * @param {string} instruction 
   * @returns {Promise<Object>}
   */
  async parseEditInstruction(existingExpense, instruction) {
    const prompt = `Data transaksi saat ini:
- Tanggal: ${existingExpense.tanggal}
- Nominal: ${existingExpense.nominal}
- Kategori: ${existingExpense.kategori}
- Keterangan: ${existingExpense.keterangan}
- Catatan Tambahan: ${existingExpense.catatan_tambahan || '-'}

Instruksi perubahan dari user:
"${instruction}"

Perbarui data transaksi di atas sesuai instruksi user.
Jika ada field yang tidak disebutkan di instruksi, PERTAHANKAN nilai aslinya dari data transaksi saat ini.
Pastikan nominal berupa angka bulat (contoh: 30000).

Kembalikan HANYA format JSON valid dengan struktur:
{
  "tanggal": "YYYY-MM-DD",
  "nominal": 30000,
  "kategori": "Kategori",
  "keterangan": "Keterangan",
  "catatan_tambahan": "Catatan"
}`;

    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah asisten pengedit data transaksi pengeluaran. Balas HANYA dengan JSON valid.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    const parsed = this._cleanAndParseJson(content);

    return {
      tanggal: parsed.tanggal || existingExpense.tanggal,
      nominal: Number(parsed.nominal) || existingExpense.nominal,
      kategori: parsed.kategori || existingExpense.kategori,
      keterangan: parsed.keterangan || existingExpense.keterangan,
      catatan_tambahan: parsed.catatan_tambahan !== undefined ? parsed.catatan_tambahan : existingExpense.catatan_tambahan,
    };
  }
}

export const sumopodService = new SumopodService();
