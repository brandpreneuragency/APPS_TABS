# Planlama incelemesi

Durum: yalnız doküman hazırlığı. Tarih: 2026-09-27.

## Gerçekten incelenenler

- Verilen briefing bütünü, repo AGENTS.md, MEMORY/AGENTS.md ve ilgili header/layout/store/database/native kaynakları okundu.
- `git status --short`: 25 eski CRM plan dosyası silinmiş; kullanıcı untracked dosyaları mevcut. Kaynak değişikliği yapılmadı.
- `git diff --stat`: eski plan paketinde 3752 satır silinmesi; bunlar bu işin değişiklikleri değildir.
- `git rev-parse --short HEAD`: c4efee2.
- `npm run tauri -- build --help`: exit 0; --no-bundle ve --config desteği doğrulandı.
- Google OAuth/Gmail belgeleri ve seçilen MIME/HTTP kütüphanelerinin resmi dokümantasyonu canlı okundu; ilgili bağlantılar sözleşme ve preflight içinde.
- User-authored skills kataloğu kontrol edildi. Hermes plan skill'i VPS yürütmesi içindir; bu yerel plana uygulanmadı.
- Tarihsel memory, mevcut task panel/assistant ve runtime ayrımlarını aramada yol gösterdi. Teknik kararlar mevcut kaynak incelemesine dayandırıldı.

## Bu turda yapılmayanlar

`npm run check`, cargo gates, build, OAuth, Google Cloud değişikliği, mailbox okuma, email gönderme, veri migration'ı ve native uygulama kabulü çalıştırılmadı. Planlama için eski test sonuçları yeniden kullanılıp başarılı gate gibi yazılmadı. Uygulama worker'ı başlatılmadı.

## Önemli bulgular

- İkinci route veya client entity gerekmiyor; mevcut Clients route'unun render'ı eksik.
- General/No Client semantiği ve General project creation korunmalı.
- Profile autosave için mevcut updateClient'in hata yutup toast gösterme davranışı tek başına yeterli değil: additive result-returning action veya wrapper gerekir; eski çağıranların davranışı korunmalı.
- Ana DB v18, companion v2. Yeni v19 önerisi execution başında rebase edilir.
- config identifier keyring namespace'e yansıyor; izolasyon için yalnız ürün adı değiştirmek yeterli değil.
- Native scheduler ile Dexie arasında dayanıklı replay gerekir.
- Baseline config minimum 1024x700 ve varsayılan 1366x900; bu iki boyut native kabulde kullanılmalı.
- Codex migration backup'ı bir defalık akış; genel export/restore ürünü gibi sunulmamalı.

## Paket doğrulaması

Paket yazıldıktan sonra yapılan kontroller:

- 26 dosya; yazılan belgelerde 46 göreli Markdown bağlantısı kontrol edildi, kırık bağlantı 0.
- 3 JSON dosyası parse edildi; 12 packet dependency referansları geçerli ve bütün packet durumları pending.
- 19 requirement ID'sinin tamamı kabul matrisinde mevcut.
- `brief/requirements.md`, kaynak briefing ile byte-for-byte aynı. Bu arşiv kopyasındaki özgün kaynak bağlantıları eski konuma göre yazılmıştır; güncel repo haritası 01 plan içindedir. Arşiv kopyası link testine dahil edilmedi.
- PowerShell AST parse başarılı. İlk gerçek çağrı parametre varsayılanında PSScriptRoot erişiminin boş döndüğünü gösterdi; package-root çözümü script gövdesine taşındı ve yeniden çalıştırıldı.
- `Test-LaunchGate.ps1 -FingerprintOnly`: exit 0; kaynak fingerprint `4f5b57e772bed7060d38a127777df0bc3ac7c095924a02ab12b9d0625e51d464`.
- `Test-LaunchGate.ps1`: child exit **2**, çıktı `BLOCKED: Preflight is not passed.`. Beklenen güvenli red sonucu ayrıca `$LASTEXITCODE` ile doğrulandı; bu ürün preflight başarısı değildir.
- Son `git status --short` ilk incelemeyle aynı: repo source ve kullanıcı WIP'ine müdahale edilmedi.

Bu kontroller plan paketini ve pending gate davranışını doğrular. Başarılı live-gate yolu, native helper, Google setup ve uygulama testleri henüz yoktur; P1/P6 görevleridir.
