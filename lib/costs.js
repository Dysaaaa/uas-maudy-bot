// Biaya eksekusi (diakses 2 Nov 2026). Order bot = taker (beli di ask, jual di bid) → tarif TAKER all-in, pasar IDR, mode Pro.
//  • /api/pairs  trade_fee_percent_taker = 0,20%  (https://indodax.com/api/pairs · salinan: data/sumber_biaya/api_pairs_2026-11-02.json)
//  • Halaman resmi "Rincian Biaya Transaksi di INDODAX" (diperbarui 1 Nov 2026, berlaku sejak 1 Okt 2026):
//    https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX  (gambar tabel: data/sumber_biaya/indodax_biaya_trading_2026-11-02.png)
//    BELI taker all-in 0,20555% (service 0,20% + pajak 0% + CFX 0,00555%) · JUAL taker all-in 0,41555% (service 0,20% + pajak 0,21% + CFX 0,00555%)
//  → dipakai yang LEBIH MAHAL: halaman resmi.
export const COSTS = Object.freeze({
  feeBuy: 0.0020555,
  feeSell: 0.0041555,
  minOrderIDR: 25000,   // /api/pairs trade_min_base_currency Rp10.000; halaman resmi: order langsung di Pro minimal Rp25.000 → dipakai yang lebih ketat
});
