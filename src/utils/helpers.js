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
