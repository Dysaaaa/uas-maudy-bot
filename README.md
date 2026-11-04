# UAS Algoritma Trading: bot dry run Indodax (Dysa Breakout Hybrid, 4 jam)

Maudy Anisa Putri · NIM 25110200026 · Algorithmic Trading · tugas individu

Repositori: https://github.com/Dysaaaa/uas-maudy-bot

Bot dry run untuk pasar kripto IDR Indodax yang berjalan di Vercel (**https://uas-maudy-bot.vercel.app**, data mentah: `/api/state`).
- **Data dan eksekusi:** candle 4 jam yang sudah tertutup dan order book dari API publik Indodax, tanpa API key. Order disimulasikan di bid/ask dengan menghabiskan level order book.
- **Penyimpanan:** state dan log di Upstash Redis (prefix `maudybot:`).
- **Satu fungsi sinyal:** `decide()` di [lib/strategy.js](lib/strategy.js) dipakai oleh bot ([api/tick.js](api/tick.js)) **dan** backtest ([tools/backtest.mjs](tools/backtest.mjs)). Validasi candle (`validateBars`) dan pemotongan jendela candle (`cutWindow`) di [lib/indodax.js](lib/indodax.js) juga dipakai keduanya.

## 1. Strategi (dibekukan saat freeze)

Strategi UTS (Dysa Trading System: Breakout Hybrid dengan filter pasar, saham Kompas100 harian) dipindahkan ke kripto IDR. Keputusan diambil di close candle 4 jam yang sudah tertutup. Panjang indikator ditulis dalam hari × 6 candle. Parameter ada di `PARAMS` dalam `lib/strategy.js`.

| Aturan | Isi |
|---|---|
| Filter pasar | Beli baru hanya bila BTC/IDR close tidak di bawah SMA 600 bar (100 hari) |
| **Beli (breakout)** | close > high tertinggi 330 bar sebelumnya (55 hari) **dan** close > SMA 600 bar (100 hari) |
| **Beli lagi (re-entry)** | sesudah exit, tidak boleh masuk di bulan yang sama. Di candle terakhir bulan, bila sudah pernah exit dan belum masuk lagi, boleh masuk bila close > SMA 600 bar. Bulan = bulan UTC waktu buka candle. |
| **Jual** | close ≤ harga beli × (1 − 8%) (diperiksa lebih dulu), **atau** close < low terendah 120 bar sebelumnya (20 hari) |
| Ukuran posisi | 10% ekuitas per posisi, maks 10 slot, satu posisi per pasangan. Dengan 8 pasangan, ekuitas terpakai paling banyak 80%. |
| Bila kandidat > slot kosong | urut dari yang terkuat (close ÷ high atau close ÷ SMA), sama dengan UTS |
| Daily loss limit | ekuitas ≤ 95% ekuitas awal hari WIB → tidak membuka posisi baru sampai 00.00 WIB berikutnya. Exit tetap berjalan. |
| Kill switch | flag `maudybot:kill = 1` di Redis (lewat `/api/kill?aktif=1`) atau env `KILL_SWITCH=1`. Tidak membuka posisi baru, exit tetap berjalan, tercatat di log `kill`. |
| Validasi sebelum beli | candle terakhir ≤ 2× timeframe, tidak ada candle hilang di 601 bar, harga tidak nol, volume candle terakhir tidak nol, order book tidak kosong, spread bid–ask ≤ 2%. Sinyal beli yang ditolak tetap dicatat di log `signals` (`valid: false` + alasannya), dan semua pasangan yang tidak valid dicatat tiap candle di log `notes`. |

### Perubahan dari versi UTS (semua sebelum freeze)
1. **Pasar:** saham Kompas100 → 8 pasangan kripto IDR Indodax. Lot 100, tick BEI, dan aturan ARA/ARB diganti aturan Indodax: kuantitas pecahan 1e-8, minimum order Rp25.000, fill menghabiskan order book.
2. **Filter pasar:** IHSG > SMA100 hari → BTC/IDR > SMA100 hari (600 bar).
3. **Timeframe harian → 4 jam,** dengan panjang indikator tetap setara hari (55, 20, dan 100 hari × 6 bar). Pilihan ini diambil **setelah** membandingkan backtest (in-sample, lihat bagian 4).
4. **Eksekusi:** UTS memakai open hari berikutnya + 1 tick. Bot mengeksekusi di order book live sesudah candle tutup (beli di ask, jual di bid). Backtest memakai open bar berikutnya ± setengah spread ± slippage terukur.
5. **Biaya:** fee broker saham diganti tarif taker all-in Indodax.
6. **Tambahan wajib UAS:** daily loss limit, kill switch, validasi data, idempotency per candle.

## 2. Universe (8 pasangan)

`BTCIDR, ETHIDR, XRPIDR, DOGEIDR, TRXIDR, VELOIDR, ADAIDR, BNBIDR`

**Kriteria.** Diukur pada **awal periode backtest**, bukan hari ini:
- rata-rata nilai transaksi harian (IDR) **3 Agustus – 31 Oktober 2023**, tertinggi;
- sudah tercatat ≥ 1 tahun;
- bukan stablecoin, emas, atau saham tokenisasi.

| Peringkat Okt 2023 | Pasangan | Nilai transaksi (miliar Rp/hari) | Status sekarang |
|---|---|---|---|
| 1 | BTC | 10,6 | aktif |
| 2 | ETH | 3,75 | aktif |
| 3 | XRP | 3,58 | aktif |
| 4 | DOGE | 1,74 | aktif |
| 5 | TRX | 1,09 | aktif |
| 6 | VRA | 1,02 | sudah delisting |
| 7 | LOOM | 0,91 | sudah delisting |
| 8 | VELO | 0,86 | aktif |
| 9 | ADA | 0,76 | aktif |
| 10 | BNB | 0,74 | aktif |

**Survivorship.** VRA dan LOOM sudah delisting sehingga tidak bisa diperdagangkan. Universe memakai 8 sisanya, tanpa pengganti yang dipilih dengan melihat hari ini. Ini dicatat sebagai keterbatasan.

**VELO** spreadnya ±3% (> 2%). Bot menolak entry VELO selama spread > 2%. Backtest memakai aturan yang sama dengan median spread terukur, sehingga VELO tidak pernah dibeli di backtest (59 sinyal beli ditolak validasi).

## 3. Biaya dan eksekusi

| Hal | Nilai dipakai | Sumber (diakses 2 Nov 2026) |
|---|---|---|
| Fee taker `/api/pairs` | 0,20% (`trade_fee_percent_taker`) | https://indodax.com/api/pairs (salinan: `data/sumber_biaya/api_pairs_2026-11-02.json`) |
| Fee taker all-in halaman resmi (pasar IDR, mode Pro, berlaku sejak 1 Okt 2026) | **beli 0,20555%** (service 0,20% + pajak 0% + CFX 0,00555%) · **jual 0,41555%** (service 0,20% + pajak 0,21% + CFX 0,00555%). Lebih mahal dari 0,20%, jadi **ini yang dipakai**. | https://help.indodax.com/hc/id/articles/4416646599705-Rincian-Biaya-Transaksi-di-INDODAX (tabel berupa gambar, salinan: `data/sumber_biaya/indodax_biaya_trading_2026-11-02.png`) |
| Minimum order | Rp25.000 (lebih ketat dari `trade_min_base_currency` Rp10.000) | /api/pairs + ketentuan mode Pro |
| Kuantitas | dibulatkan ke bawah 1e-8 | /api/pairs |
| Fill bot | beli menghabiskan level **ask**, jual menghabiskan level **bid** (harga rata-rata). Tidak pernah memakai mid atau close. | /api/depth |
| Fill backtest | open bar berikutnya × (1 ± setengah spread ± slippage), median **terukur** per pasangan dari snapshot order book (`data/spread_median.json`, ukuran order Rp15 jt) | snapshot 2 Nov – 4 Nov 2026 02.40 UTC |
| Penilaian ekuitas | posisi terbuka dinilai di best bid; ekuitas harian = panggilan pertama sesudah 00.00 WIB | — |

## 4. Backtest (≥ 3 tahun, data asli Indodax)

```
node tools/fetch_history.mjs 240 2022-02-01      # tarik candle 4 jam mundur (laptop, berurutan, < 3 request/detik)
node tools/ekspor_log.mjs                        # snapshot order book dari bot → data/forward/state.json
node tools/spread_stats.mjs 15000000 2026-11-04T02:40   # median spread & slippage, batas data 4 Nov 02.40 UTC (09.40 WIB)
node tools/backtest.mjs 2023-11-01 --trades data/bt_trades.csv --sinyal data/bt_sinyal.csv --ekuitas data/bt_ekuitas.csv --ringkasan public/backtest_ringkasan.json
```

**Hasil 1 Nov 2023 – 4 Nov 2026 (3,0 tahun)**, modal Rp100 jt:

| Metrik | Bot Dysa 4 jam | Beli & tahan BTC/IDR |
|---|---|---|
| Return total | +96,5% | +155,9% |
| CAGR | 25,17% | – |
| MDD | −23,4% | −49,4% |
| Trade | 85 | – |
| Win rate | 32,9% | – |
| Profit factor | 2,27 | – |
| Rata-rata untung / rugi | +44,0% / −7,3% | – |
| Porsi biaya (Σ biaya ÷ hasil sebelum biaya) | 11,2% | – |

Per tahun: 2023 (Nov–Des) +14,2% · 2024 +75,2% · 2025 −1,0% · 2026 −0,8%. Per pasangan: `data/backtest_2023-11.txt`.

**Catatan slippage.** Angka di `data/spread_median.json` adalah median dari hanya 14 snapshot per pasangan (ukuran order Rp15 jt), karena bot ini baru dijalankan 4 Nov pagi. Median slippage banyak yang mendekati 0 karena level harga terbaik sering cukup dalam. Backtest memakai median, jadi bisa lebih optimistis dibanding fill nyata saat order book tipis. Selisihnya diukur di refleksi.

**Perbandingan timeframe** (aturan dan mesin sama, `data/banding_timeframe.txt`; dijalankan 4 Nov pagi dengan median spread sebelum angka final):

| Timeframe | CAGR 2023-11 → 2026-11 | MDD | PF | Trade | CAGR 2022-11 → 2026-11 |
|---|---|---|---|---|---|
| 1 jam (55/20/100 bar) | 17,0% | −11,2% | 2,12 | 253 | 9,4% |
| 4 jam (55/20/100 bar) | 13,8% | −22,1% | 1,62 | 207 | 12,6% |
| **4 jam, setara hari (330/120/600 bar), dipakai** | **25,3%** | −23,4% | 2,28 | 85 | 18,3% |
| Harian (55/20/100 hari, seperti UTS) | 25,6% | −28,9% | 2,13 | 77 | 16,8% |

**Catatan jujur:**
- Pemilihan timeframe dilakukan setelah melihat hasil backtest, jadi angka 25,17% bersifat in-sample.
- Bila backtest dimulai 1 Nov 2022, CAGR turun menjadi **18,2%** (MDD −23,4%, PF 2,09, 113 trade); `data/backtest_2022-11.txt`.
- Strategi kalah dari beli & tahan BTC dalam return, tetapi MDD-nya sekitar setengah.
- Hasil sangat bergantung pada 2024. Tahun 2025 dan 2026 mendekati datar.
- DOGE merugi (PF 0,39). Hasil ini tidak dipakai untuk mengeluarkan DOGE dari universe.
- Rata-rata hanya sekitar 1 trade tiap 13 hari, jadi forward test 10 hari bisa berisi sedikit trade atau tidak sama sekali.

## 5. Bot di Vercel

| File | Fungsi |
|---|---|
| `api/tick.js` | Satu panggilan bot. Dilindungi `Authorization: Bearer CRON_SECRET` atau tanda tangan QStash. |
| `api/state.js` | Data publik dashboard: state dan log mentah, tanpa secret |
| `api/kill.js` | Kill switch, dilindungi `CRON_SECRET` |
| `api/jadwal.js` | Membuat/memeriksa jadwal QStash dari server (token QStash tidak keluar) |
| `vercel.json` | Cron Vercel harian sebagai cadangan, `maxDuration` 300 detik |

**Pengaman di kode:**
- **Idempotency:** kunci Redis `SET NX EX 240` menolak panggilan paralel, dan `state.lastCandle` memastikan tiap candle hanya diproses sekali. Panggilan tiap jam aman; candle 4 jam tetap diproses sekali.
- **Retry:** tiap request maks 3 kali, timeout 10 detik. Error tercatat di log `errors`.
- **Candle tertutup saja:** bar dengan `Time + 4 jam > server_time` dibuang.
- **Forward test mulai datar:** saat freeze, state masa persiapan direset sekali (tercatat di log `notes`).

**Log di Redis** (list `maudybot:log:*`, JSON per baris): `calls`, `signals`, `orders`, `equity`, `errors`, `snapshots`, `kill`, `notes`.

**Penjadwal:**
| Penjadwal | Jadwal | Otorisasi |
|---|---|---|
| Upstash QStash (utama) | tiap jam menit ke-5 (`5 * * * *`) → `GET /api/tick?sumber=qstash` | tanda tangan QStash, diverifikasi di [lib/auth.js](lib/auth.js) |
| GitHub Actions (cadangan, opsional) | tiap jam menit ke-9, `.github/workflows/tick.yml` | secret `CRON_SECRET` + `TICK_URL` |
| Vercel Cron (cadangan) | 00.17 UTC tiap hari | `CRON_SECRET` (otomatis dari Vercel) |

### Langkah deploy
1. Buat proyek Vercel dari repositori ini. Framework: *Other*.
2. Pasang integrasi **Upstash Redis** dan **Upstash QStash** di proyek. `KV_REST_API_*` dan `QSTASH_*` terisi otomatis.
3. Isi environment variable sesuai `.env.example`: `CRON_SECRET` (string acak panjang), `FREEZE_AT`, `REDIS_PREFIX`, `PUBLIC_URL`. Lalu deploy ulang.
4. Uji koneksi: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<proyek>.vercel.app/api/tick?sumber=uji`. Respons harus `DIPROSES` atau `CANDLE_SUDAH_DIPROSES`, dengan `jumlah_error` 0.
5. Buat jadwal: `curl -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<proyek>.vercel.app/api/jadwal`.
6. Kill switch: `curl -H "Authorization: Bearer <CRON_SECRET>" "https://<proyek>.vercel.app/api/kill?aktif=1"` (matikan dengan `aktif=0`).

Uji lokal tanpa Vercel (Redis tiruan di memori, API Indodax asli): `node tools/tes_lokal.mjs`. Panggilan kedua harus `CANDLE_SUDAH_DIPROSES`.

## 5b. Dashboard, log, dan hitung ulang

Dashboard Vercel dihitung di browser dari `/api/state` lewat [public/metrics.js](public/metrics.js) dan ditampilkan oleh [public/render.js](public/render.js).

Sesudah forward test selesai:
```
node tools/ekspor_log.mjs                 # semua log mentah → data/forward/state.json + log_*.csv
node tools/fetch_history.mjs 240 2022-02-01
node tools/hitung_ulang.mjs               # backtest ulang + backtest jendela forward + pencocokan sinyal & fill + dashboard_offline.html
```

| Metrik | Definisi |
|---|---|
| Porsi biaya | Σ (fee + spread + slippage) ÷ Σ hasil sebelum biaya |
| Spread/slippage per order | selisih harga fill terhadap mid ((best bid + best ask) ÷ 2) |
| Uptime | candle 4 jam yang diproses sebelum candle berikutnya tutup ÷ jumlah candle di jendela forward |

## 6. Freeze

| Hal | Isi |
|---|---|
| Waktu freeze | **Rabu 4 Nov 2026 12.00 WIB** (05.00 UTC) |
| Forward test | 4 Nov 12.00 – 14 Nov 2026 12.00 WIB |
| Commit freeze | *(hash diisi sesudah commit)* |

Aturan, parameter, dan universe di `lib/strategy.js`, `lib/costs.js`, dan `lib/indodax.js` (`PAIRS`) **tidak diubah** sesudah commit freeze. Perbaikan bug yang tidak mengubah aturan dicatat di bagian 7.

## 7. Catatan perubahan sesudah freeze
*(kosong)*
