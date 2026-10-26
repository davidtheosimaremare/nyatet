import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { getCurrentDateWIB } from '../utils/helpers.js';

export class GeminiService {
  constructor() {
    this.ai = null;
    this.modelName = config.geminiModel;
  }

  getAI() {
    if (!this.ai) {
      if (!config.geminiApiKey) {
        throw new Error('GEMINI_API_KEY belum diset di file .env');
      }
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    }
    return this.ai;
  }

  _getSystemInstruction(currentDate) {
    return `Kamu adalah asisten pencatat keuangan pribadi dalam Bahasa Indonesia.
Tugasmu adalah menganalisis input pengeluaran berupa teks, gambar struk belanja / faktur / QRIS, atau rekaman suara (voice note) dalam bahasa Indonesia atau bahasa sehari-hari.

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
6. Jika pada struk atau suara terdapat beberapa transaksi pengeluaran berbeda, ekstrak semuanya ke dalam daftar expenses.`;
  }

  _getResponseSchema() {
    return {
      type: Type.OBJECT,
      properties: {
        expenses: {
          type: Type.ARRAY,
          description: 'Daftar transaksi pengeluaran yang berhasil diekstrak',
          items: {
            type: Type.OBJECT,
            properties: {
              tanggal: {
                type: Type.STRING,
                description: 'Format tanggal YYYY-MM-DD',
              },
              nominal: {
                type: Type.NUMBER,
                description: 'Nominal pengeluaran dalam Rupiah (angka bulat positif)',
              },
              kategori: {
                type: Type.STRING,
                description: 'Kategori pengeluaran',
              },
              keterangan: {
                type: Type.STRING,
                description: 'Deskripsi barang atau jasa yang dibeli',
              },
              catatan_tambahan: {
                type: Type.STRING,
                description: 'Metode pembayaran atau catatan tambahan (opsional)',
              },
            },
            required: ['tanggal', 'nominal', 'kategori', 'keterangan'],
          },
        },
        ringkasan: {
          type: Type.STRING,
          description: 'Pesan konfirmasi ramah dan singkat tentang pengeluaran yang dicatat',
        },
      },
      required: ['expenses'],
    };
  }

  /**
   * Parse pengeluaran dari teks
   */
  async parseText(text) {
    const currentDate = getCurrentDateWIB();
    const response = await this.getAI().models.generateContent({
      model: this.modelName,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Analisis pengeluaran dari teks berikut:\n"${text}"` }],
        },
      ],
      config: {
        systemInstruction: this._getSystemInstruction(currentDate),
        responseMimeType: 'application/json',
        responseSchema: this._getResponseSchema(),
      },
    });

    return JSON.parse(response.text);
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

    const response = await this.getAI().models.generateContent({
      model: this.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: this._getSystemInstruction(currentDate),
        responseMimeType: 'application/json',
        responseSchema: this._getResponseSchema(),
      },
    });

    return JSON.parse(response.text);
  }

  /**
   * Parse pengeluaran dari file audio / voice note
   * @param {string} base64Data
   * @param {string} mimeType
   */
  async parseAudio(base64Data, mimeType = 'audio/ogg') {
    const currentDate = getCurrentDateWIB();
    const response = await this.getAI().models.generateContent({
      model: this.modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Dengarkan rekaman suara (voice note) ini dengan seksama. Pahami transkripnya dan ekstrak rincian pengeluaran.',
            },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: this._getSystemInstruction(currentDate),
        responseMimeType: 'application/json',
        responseSchema: this._getResponseSchema(),
      },
    });

    return JSON.parse(response.text);
  }
}

export const geminiService = new GeminiService();
