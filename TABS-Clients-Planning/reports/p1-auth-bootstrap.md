# P1 — OAuth test uygulaması hazırlığı

27 Eylül 2026. P1 kısmen uygulandı; G1 **pending**. P2 ve ürün geliştirme paketleri başlamadı.

## Son güncelleme — kısa bağlantı preflight'ı

Bu bölüm aşağıdaki ilk bootstrap kaydının güncel devamıdır. Kullanıcı hız istedi; tekrarlı login/restart ve ayrıntılı gönderim/yanıt/iletme/ek testleri bu turda yapılmıyor. Erteleme test başarısı veya gönderim izni sayılmaz. Tam G1 receipt ve otomatik launch gate pending kalır.

- İlk gerçek bağlantı PID 29712'de başarılı: iki scope ve beklenen mailbox profile GET ile doğrulandı.
- Kullanıcı test uygulamasını kapatıp açtı. Yeni PID 31888; önceki startup 1790475506931, yeni startup 1790476053120. `last-auth-check.json`: operation=refresh, status=passed, forcedRefresh=true, checkedAt=1790476074221. Tekrar sign-in yapılmadan keyring yetkisi kullanıldı.
- Yeni kontrol, aynı native auth/HTTP yoluyla önce forced refresh/profile doğrular, ardından Gmail `users.messages.list` uç noktasına yalnız `resultSizeEstimate`, maxResults=1 ve connection sonrası cutoff ile GET yapar. Sıfır sonuç da erişim başarısıdır. Message ID, konu, adres, body veya attachment istemez/kaydetmez; etiket değiştirme veya send yapmaz.
- Bu kontrol **PF-READ değildir**: sentetik body/attachment hash, read-state before/after veya dedup kanıtı üretmez. Kısa API erişim kontrolüdür.
- Native `gmail_check_read_access`, acceptance-only capability, Türkçe/İngilizce UI düğmesi ve açık `--check-read-access` başlatma seçeneği eklendi. Normal başlatma ağa çıkmaz. Sonuç private `last-read-access-check.json` içinde adres/token içermeden tutulur.
- `npm run check`: exit 0, 65 dosya / 337 test, mevcut 9 lint warning; TypeScript ve build başarılı.
- `cargo fmt --check`, acceptance config ile `cargo check --locked --features clients-acceptance`: exit 0. `cargo test --locked --features clients-acceptance --lib`: exit 0, 11 test.
- Bu turda production native kodu değişmedi; daha önce geçen normal build kontrolü tekrar çalıştırılmadı. Görsel UI otomasyonu ve geniş canlı gönderim testleri tekrar edilmedi.

Son source fingerprint: `01ac46da8d80a16c9ef07e6cfa083793dfe02d4f64c165be9aba33b867923116`.

### Güncel native ve canlı sonuç

- `Build-ClientsAcceptance.ps1`: exit 0; no-bundle release build 1m15s. Yeni exe SHA256 `812ecfaf6f588f2adf70c3ff797b39389d080fd398977f9aa86fd50e4785e147`.
- Eski acceptance PID 31888 normal pencere kapanışıyla kapatıldı; production PID 22184 açık kaldı. Yeni acceptance PID 25004, açık `--check-read-access` seçeneğiyle başlatıldı.
- Yeni process'in kendi `last-read-access-check.json` çıktısı: status=passed, checkedAt=1790476507697, forcedRefresh=true, profileVerified=true, listEndpointVerified=true, messageContentDownloaded=false, noSendPerformed=true, g1Passed=false.
- Güncel adapter ile gerçek refresh/profile/list GET başarılı. OAuth consent akışı tekrar edilmedi; önceki consent kanıtı tarihsel kalır. Sentetik body/attachment/send/recipient/threading veya tam UI kabulü yapılmış sayılmaz.
- Kurulu TABS exe SHA256 değişmedi: `DEC154CBD95BB9B7E1B67F945E21149C4C098C846020A3F414B6832D1BBE1E4B`.
- Sıradaki iş: ayrıntılı canlı kabulü sonraki özellik aşamasında ele almak. Tam G1 ve otomatik ana koşu kapısı kapalı; bu sonuç yalnız temel Google bağlantı hazırlığıdır. Gönderim için hâlâ açık recipient/action/count/expiry izni gerekir.

Gmail uç noktası referansı: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list

## İlk bootstrap kaydı (aşağıdaki pending login/restart ifadeleri tarihsel)

## Hazır olan bölüm

- Workspace/Internal seçimi kullanıcı tarafından bildirildi. Gmail readonly/send kapsamları kullanıcı ekranında görüldü; kaydettiği bildirildi. Bu, gerçek OAuth grant doğrulaması sayılmaz.
- Yerel özel OAuth JSON dosyası masaüstü istemcisi yapısı açısından kontrol edildi; hiçbir değeri rapora alınmadı.
- `clients-acceptance` feature'ı ve `com.tabs.clients.acceptance` identifier birlikte doğrulanır. Yanlış production/acceptance config birleşimi açılışı reddeder.
- Ayrı native startup production komutlarını, terminal/asistanı, global shortcut, updater ve dosya association/argv akışını yüklemez. Ayrı WebView dataDirectory kullanılır; yeni test-only capability FS/shell/updater yetkisi vermez.
- System browser OAuth: PKCE S256, rastgele state, 127.0.0.1 rastgele port, 180 saniye sınırı, iptal, host/path/state/code doğrulaması, sınırlı JSON/HTTP okumaları ve redirect reddi.
- Kullanıcı beklenen mailbox'ı uygulamada yazar. Profile GET ile hesap eşleşmesi doğrulanmadan credential kaydı başarılı sayılmaz. İki kapsam doğrulanır; refresh token Windows keyring'de, access token yalnız native bellektedir.
- Kayıtlı oturum testi her seferinde gerçek refresh exchange ve profile GET yapar. Uygulama açılışı kendiliğinden OAuth veya Gmail isteği başlatmaz.
- Test UI Türkçe/İngilizce, ayrı sentetik IndexedDB marker, güvenli hata kodları ve oturum/yenileme/çıkış işlemleri sunar. Production App/store/migration modülü bu girişte değerlendirilmez.
- Posta okuma/gönderme komutu henüz yoktur. Hiçbir mail gönderilmedi. Tam Clients UI veya yeni production DB migration'ı yapılmadı.

## Değişen kaynak dosyaları

- `src-tauri/Cargo.toml`, `Cargo.lock`, `build.rs`, `src/lib.rs`.
- `src-tauri/src/acceptance/mod.rs`, `src-tauri/src/gmail/mod.rs`.
- `src-tauri/tauri.clients-acceptance.conf.json`, `src-tauri/acceptance-permissions/bootstrap.toml`.
- `src/main.tsx`, `src/services/runtime.ts`, `src/services/updater.ts`.
- `src/services/gmail/acceptance.ts`, `acceptance.test.ts`.
- `src/components/clients/acceptance/AcceptanceApp.tsx`, `acceptance.css`.
- `src/i18n/en.ts`, `src/i18n/tr.ts`.
- `scripts/clients/Build-ClientsAcceptance.ps1`, `Start-ClientsAcceptance.ps1`.

Native HTTP/URL/randomness bağımlılıkları acceptance feature'ına bağlı ve pinlidir: reqwest 0.12.28, url 2.5.8, getrandom 0.2.17. Doğrudan crate MSRV/lisans bildirimleri incelendi; doğrulanan toolchain rustc/cargo 1.95.0'dır. Bütün transitif ağacın Rust 1.77'de çalıştığı iddia edilmez; mevcut projede daha yeni Rust isteyen bağımlılıklar zaten vardır.

## Gerçek kontroller

| Komut | Sonuç |
|---|---|
| İlk `npm run check` (P0) | Exit 0; 64 dosya, 334 test; 9 lint warning, build başarılı |
| İlk `cargo fmt --check`, `cargo check --locked` (P0) | Exit 0 |
| `npm run test -- src/services/gmail/acceptance.test.ts` | Exit 0; 3 test |
| Son `npm run check` | Exit 0; 65 dosya, 337 test; 0 lint error, mevcut 9 warning; build başarılı |
| `cargo fmt --check` | Exit 0 |
| `cargo check --features clients-acceptance` (acceptance TAURI_CONFIG) | Exit 0 |
| `cargo check --locked` (normal production config) | Önce E0283; context tip çıkarımı düzeltildi, tekrar exit 0 |
| `cargo test --locked --features clients-acceptance --lib` (acceptance TAURI_CONFIG) | Son source ile exit 0; 10 test |
| `Build-ClientsAcceptance.ps1` | Exit 0; no-bundle release exe, native build 3m32s |
| İki PowerShell helper AST parse | 0 parse error |
| `git diff --check` | Exit 0 |

Npm build'de mevcut büyük chunk/dynamic import uyarıları bulunur. Yeni kaynak için bilinen test hatası kalmadı. Ayrı yazarlı review henüz yapılmadı.

Source fingerprint: `867fe79e0b8a1a0143ee74b3fb50261a71f159a7f241d5b639b561e2c0391382`.

## Native açılışta gözlenenler

- Exe: `%LOCALAPPDATA%\TABS-Clients-Acceptance\cargo-target\release\tabs.exe`.
- SHA256: `735a1d7af9415461e357825f73f6e9d785077a4306852b4f20d3a64153233643`.
- Test PID 29712 ve başlık `TABS Clients Acceptance` görüldü. Native `runtime.json` çıktısındaki `uiIpcReached=true`, React mount sonrası IPC erişimini doğruladı.
- WebView: `%LOCALAPPDATA%\com.tabs.clients.acceptance\webview`.
- Keyring service: `com.tabs.clients.acceptance.gmail`.
- İkinci açılış PID 35012 kalıcı ikinci instance oluşturmadı; test PID 29712 ve kurulu TABS PID 22184 korundu.
- Kurulu exe SHA256, test başlatmadan önce/sonra aynı: `DEC154CBD95BB9B7E1B67F945E21149C4C098C846020A3F414B6832D1BBE1E4B`.
- Installer üretilmedi/çalıştırılmadı. Kurulu TABS kapatılmadı, production storage okunmadı veya migrate edilmedi.
- Computer Use araç başlangıcı eksik `tslib.es6.js` nedeniyle iki kez başarısız oldu; görsel/UI kabulü ve gerçek restart testi yapılmış sayılmadı. Test process'i açık bırakıldı.

## Devam ve kalan sınırlar

1. Açık test uygulamasında beklenen Workspace mailbox'ını yazıp **Google ile bağlan** seç. Kullanıcı sistem tarayıcısında giriş/consent'i tamamlar; secret sohbetten istenmez.
2. Başarı sonrası test uygulamasını kendi Quit düğmesiyle kapatıp `Start-ClientsAcceptance.ps1` ile aç; **Kayıtlı oturumu doğrula** seç. Sonuç `last-auth-check.json` içinde adres/token içermeyen operational kayıt olarak tutulur. Bu kayıt tek başına PF receipt değildir.
3. Kullanıcının ikinci posta kutusu yok. Önce kendine gönderim düzeninin hangi alıcı/threading/Bcc iddialarını kanıtlayabildiği belirlenmeli; eksikler passed sayılmamalı.
4. Send izni, exact recipient/action/count/expiry ve observer hazır değil. Henüz hiçbir gönderim izni varsayılmadı.
5. P1'in fixture okuma/attachment/MIME/send/reply/reply-all/forward, atomik permit defteri, receiver observer ve `Invoke-ClientsReadiness.ps1` bölümleri henüz uygulanmadı. Bunlar aynı Gmail modülü üzerinde devam etmeli.
6. OAuth canlı testi, refresh-after-restart, tüm PF-* kanıtları, 14 isolation assertion'ının tamamı ve bağımsız review eksik. `preflight-receipt.json` pending bırakıldı; G1 açılmadı.

Etkin paket, kullanıcının verdiği repo içindeki `TABS-Clients-Planning` klasörüdür. Eski prompt'lardaki MEMORY/output mutlak yollarını bu köke göre çöz. Kaynak/kurulu uygulama ile planın GitHub kopyasını birbirine karıştırma; source için commit/push yapılmadı.
