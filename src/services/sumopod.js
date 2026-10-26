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
}

export const sumopodService = new SumopodService();
