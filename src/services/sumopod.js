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

  /**
   * System instruction lengkap untuk AI Financial Chatbot & Accountant
   */
  _getAgentSystemInstruction(financialContext, currentDate) {
    return `Kamu adalah Finny, asisten AI keuangan pribadi dan akuntan cerdas (Certified Personal Financial Planner) yang ramah, santun, objektif, dan suportif.
Kamu berbicara dalam Bahasa Indonesia yang santai, alami, dan solutif.
Kamu memiliki akses langsung ke seluruh data keuangan pengguna yang tersimpan di Google Sheets.

Konteks Waktu Saat Ini:
- Tanggal: ${currentDate} (WIB)

${financialContext || '(Belum ada data transaksi yang tercatat)'}

PERAN DAN INSTRUKSI INTENT:
Kenali maksud pesan pengguna dan tentukan satu 'intent' yang paling tepat:

1. RECORD_EXPENSE (Mencatat Pengeluaran Baru):
   - Jika pengguna menyebutkan pengeluaran baru (misal: "kopi 25rb", "tadi siang beli nasi padang 30k", "isi bensin pertamax 50rb bayar qris", atau kiriman struk belanja).
   - Ekstrak seluruh item ke dalam array 'expenses':
     * tanggal: YYYY-MM-DD (ambil tanggal struk jika ada, atau gunakan default hari ini: ${currentDate})
     * nominal: angka bulat positif dalam Rupiah (tanpa titik/koma/Rp)
     * kategori: pilih salah satu dari [Makanan & Minuman, Belanja Kebutuhan, Transportasi, Tagihan & Utilitas, Hiburan & Liburan, Kesehatan, Lain-lain]
     * keterangan: nama barang/jasa yang dibeli
     * catatan_tambahan: metode pembayaran (QRIS, BCA, Tunai, dsb) atau catatan lainnya
   - Buat konfirmasi ramah di 'reply' yang menyapa dan merangkum apa yang baru dicatat.

2. EDIT_EXPENSE (Mengubah / Mengoreksi Transaksi):
   - Jika pengguna ingin mengubah transaksi yang sudah tercatat sebelumnya (misal: "kopi tadi ubah jadi 30rb", "yang kemarin makan siang ganti nominal 45rb bayar bca", "edit baris 15 nominal 40rb").
   - Cari baris transaksi terkait di DAFTAR TRANSAKSI di atas.
   - Set 'edit': {
       "rowIndex": <nomor_baris_dari_daftar>,
       "tanggal": "YYYY-MM-DD",
       "nominal": number,
       "kategori": string,
       "keterangan": string,
       "catatan_tambahan": string
     }
   - Berikan konfirmasi perubahan yang jelas di 'reply'.

3. DELETE_EXPENSE (Menghapus Transaksi):
   - Jika pengguna minta menghapus transaksi (misal: "hapus transaksi kopi yang tadi", "hapus baris 8", "batalkan pengeluaran bensin tadi").
   - Cari nomor baris transaksi yang dimaksud di DAFTAR TRANSAKSI di atas.
   - Set 'deleteRowIndex': <nomor_baris>.
   - Berikan konfirmasi di 'reply'.

4. CHAT_QUERY (Tanya Jawab Keuangan, Saran, Rekap, atau Analisa):
   - Jika pengguna bertanya tentang data keuangannya, berdiskusi, meminta saran/pertimbangan finansial, atau sekadar mengobrol:
     * Contoh: "Berapa total yang saya keluarin buat kopi bulan ini?", "Apakah saya boros minggu ini?", "Kemarin saya makan apa aja ya?", "Boleh gak saya beli smartwatch 2 juta kalau lihat cashflow saya?", "Berapa sisa pengeluaran saya bulan ini?", "Kategori apa yang paling banyak nyedot uang?"
   - Gunakan data keuangan di atas untuk menjawab secara akurat, faktual, mendalam, dan bersahabat.
   - Sebutkan angka-angka riil, persentase, dan perbandingan konkret dari data pengguna.
   - Berikan saran finansial yang cerdas dan realistis.
   - 'expenses': [], 'edit': null, 'deleteRowIndex': null.

FORMAT OUTPUT WAJIB:
Balas HANYA dengan JSON valid persis dengan struktur berikut:
{
  "intent": "RECORD_EXPENSE" | "EDIT_EXPENSE" | "DELETE_EXPENSE" | "CHAT_QUERY",
  "expenses": [ ... ],
  "edit": null,
  "deleteRowIndex": null,
  "reply": "Pesan jawaban ramah, cerdas, dan lengkap untuk user dalam format Markdown Telegram (gunakan *tebal* dan _miring_)"
}`;
  }

  _cleanAndParseJson(rawText) {
    if (!rawText) return { intent: 'CHAT_QUERY', expenses: [], reply: '' };
    let clean = rawText.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    try {
      return JSON.parse(clean.trim());
    } catch (err) {
      console.error('Gagal parse JSON dari Sumopod:', clean);
      // Fallback jika model menjawab dalam bentuk teks polos
      return {
        intent: 'CHAT_QUERY',
        expenses: [],
        reply: rawText,
      };
    }
  }

  /**
   * Chatting interaktif dengan AI yang memahami seluruh data keuangan pengguna
   * @param {Object} params
   * @param {string} params.userText
   * @param {string} params.financialContext
   * @param {Array} params.history
   */
  async chatWithAgent({ userText, financialContext = '', history = [] }) {
    const currentDate = getCurrentDateWIB();
    const systemPrompt = this._getAgentSystemInstruction(financialContext, currentDate);

    const formattedHistory = (history || []).slice(-6).map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedHistory,
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    return this._cleanAndParseJson(content);
  }

  /**
   * Analisis multimodal gambar (struk / bon / foto barang dengan pertanyaan keuangan)
   * @param {Object} params
   * @param {string} params.base64Data
   * @param {string} params.mimeType
   * @param {string} params.caption
   * @param {string} params.financialContext
   * @param {Array} params.history
   */
  async chatWithImage({ base64Data, mimeType = 'image/jpeg', caption = '', financialContext = '', history = [] }) {
    const currentDate = getCurrentDateWIB();
    const systemPrompt = this._getAgentSystemInstruction(financialContext, currentDate);

    const userPrompt = caption
      ? `Pengguna mengirimkan gambar dengan pesan/caption: "${caption}"\nAnalisis gambar ini. Jika ini struk pengeluaran, ekstrak itemnya (intent: RECORD_EXPENSE). Jika ini foto barang/makanan yang disertai pertanyaan atau diskusi keuangan, jawab secara cerdas dengan memanfaatkan konteks keuangan pengguna (intent: CHAT_QUERY).`
      : 'Pengguna mengirim foto struk/bukti bayar. Analisis dan ekstrak item pengeluaran ke dalam array expenses (intent: RECORD_EXPENSE).';

    const formattedHistory = (history || []).slice(-4).map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));

    const response = await this.getClient().chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        ...formattedHistory,
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
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
      temperature: 0.2,
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    return this._cleanAndParseJson(content);
  }

  /**
   * Transkripsi audio / voice note menggunakan model Whisper
   * @param {string} base64Data
   * @param {string} mimeType
   * @returns {Promise<string>}
   */
  async transcribeAudio(base64Data, mimeType = 'audio/ogg') {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      const file = await toFile(buffer, 'voice.ogg', { type: mimeType });

      const transcription = await this.getClient().audio.transcriptions.create({
        file,
        model: 'whisper-1',
      });

      return transcription?.text || '';
    } catch (error) {
      console.error('Error saat transkripsi audio di Sumopod:', error.message);
      throw new Error(
        `Gagal mentranskripsi suara: ${error.message}. Pastikan model Whisper tersedia di Sumopod atau gunakan pesan teks/foto struk.`
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

    const transactionSummary = expenses.slice(-25).map(e => 
      `- ${e.tanggal}: ${e.keterangan} (${e.kategori}) = Rp ${e.nominal.toLocaleString('id-ID')} [${e.catatan_tambahan || '-'}]`
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
   * Helper parsing teks biasa (backward compatibility)
   */
  async parseText(text, financialContext = '') {
    return this.chatWithAgent({ userText: text, financialContext });
  }

  /**
   * Helper parsing gambar (backward compatibility)
   */
  async parseImage(base64Data, mimeType = 'image/jpeg', caption = '', financialContext = '') {
    return this.chatWithImage({ base64Data, mimeType, caption, financialContext });
  }

  /**
   * Helper parsing audio (backward compatibility)
   */
  async parseAudio(base64Data, mimeType = 'audio/ogg', financialContext = '') {
    const text = await this.transcribeAudio(base64Data, mimeType);
    if (!text) {
      throw new Error('Hasil rekaman suara tidak terdengar jelas atau kosong.');
    }
    return this.chatWithAgent({ userText: text, financialContext });
  }
}

export const sumopodService = new SumopodService();
