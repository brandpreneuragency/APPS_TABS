# Kabul matrisi ve final doğrulama

Her sonuç `candidateFingerprint + contractHash + executableSha256 + configSha256 + checkedAt` ile bağlanır. Bu tablo planlanan kabulü gösterir; başlangıçta tüm satırlar pending'dir.

## Gereksinim → paket → test → native/live kanıt

| ID | Paket | Otomatik test / assertion | Gerçek kabul eylemi ve evidence |
|---|---|---|---|
| CL-01 | P3-C, P5 | ModeNavigation.test.tsx; CRMWorkspace.test.tsx; clients navigation tests: 5 main tabs, bir active tab | Native tüm sekmeler arasında geç; reports/native/CL-01.json |
| CL-02 | P3-C, P5 | LeftNarrowSidebar regression; shell/view state tests; Everything/No Client görünür, More yalnız legacy | 1366x900 ve 1024x700; kategori doğru sütunda, collapse/resize; reports/native/CL-02.json |
| CL-03 | P3-A, P4-C | records/migration.test.ts, clientStore.delete.test.ts, AddNewClientButton.test.tsx; ID/General/create/delete/detach | Yeni synthetic brand→General→task; sekmelerde aynı kimlik; silince arşiv erişimi; reports/native/CL-03.json |
| CL-04 | P4-C | overview.test.ts; root/subtask/soft delete/status/date; reactive updates | Task List'ten değişiklik yap, Overview güncellensin; link doğru scope açsın; reports/native/CL-04.json |
| CL-05 | P3-A, P4-A | profile UI/store tests; primary/null, 500 ms save, revision/brand-switch, validation/conflict | Yavaş/failed save sırasında marka değiştir, retry ile doğru markaya yaz; reports/native/CL-05.json |
| CL-06 | P3-A, P4-A | notes/drafts tests; pin/delete/restore, internal label, attachment saga | Note draft+attached file, Quit/reopen, edit/pin/trash/restore; reports/native/CL-06.json |
| GM-01 | P1, P3-B | Rust OAuth/state/PKCE/token tests, secret-free DTO test | G1 PF-OAUTH/IDENTITY/RESTART/REFRESH ve final refresh; reports/live/GM-01.json |
| GM-02 | P3-A/B, P4-B | matching/cutoff/accounts tests: duplicate address, ambiguous, manual block, reconnect | Native inbound/sent brand link; different mailbox IDs/cursors synthetic test; reports/native/GM-02.json |
| GM-03 | P1, P3-B, P4-B | Rust MIME/recipient/threading tests, composer mode tests | İzinli new/reply/reply-all/forward gerçek receiver observation; reports/live/GM-03.json |
| GM-04 | P1, P4-B | Endpoint allowlist + local read transaction; no modify | Fixture Gmail label before/after aynı, TABS unread değişir; reports/live/GM-04.json |
| GM-05 | P3-A/B, P5 | fake clock/backoff/history404, staged batch→Dexie ack, snapshot race | Başka tab, tray-hidden poll, Quit/restart catchup; kontrollü network/resume evidence; reports/native/GM-05.json |
| GM-06 | P3-A/B, P4-B | double submit, after-accept timeout, all journal crash points, ack loss | Native kill/restart yalnız test process; prepared/unknown otomatik send yapmıyor; reports/native/GM-06.json |
| GM-07 | P3-A/B | source deleted vs transient; post-cutoff old thread; retained/missing file | Sentetik provider 404/deletion fixture; downloaded body/dosya restart sonrası var, hiç indirilmeyen açıklamalı; reports/native/GM-07.json |
| GM-08 | P3-B, P4-B, P5 | HTML/script/form/remote-image, CRLF, traversal/ADS/device path, file size/mime tests | Native unsafe fixture'da ağ yüklemesi/IPC yok; unsafe dosya çalışmıyor; reports/native/GM-08.json |
| UX-01 | P3-C, P4-A/B/C, P5 | keyboard tab/arrows/Escape/back/focus, empty/error/loading, EN/TR key parity | Normal/minimum size, assistant open/closed/swapped, text-size min/default/max, bağımsız scroll; reports/native/UX-01.json |
| RG-01 | P5, P6 | Mevcut tüm suite + header/layout/task/CRM/forms regression | Docs/edit; Tasks/calendar/projects; passive CRM/forms; settings/terminal/assistant synthetic smoke; reports/native/RG-01.json |
| RG-02 | P4-C, P5 | taskAssistantBinding/taskAIContext contracts: mail/note alanları yok; outbound-only manual send | Diff/call-site review, assistant scope stable; reports/review/RG-02.json |
| OP-01 | P0/P1/P6 | acceptance path/identity tests, process/config proof, forbidden target checks | Production instance/PID/exe korunmuş; ayrı WebView/keyring/journal, no installer/update; reports/native/OP-01.json |
| OP-02 | P6/P7 | no-bundle config/command, frozen fingerprint | Tam uygulamada gerçek isolated UI + live Gmail; compile-only yeterli değil; reports/final-gates.json |

## Fixture seti

Normal set: 30 synthetic brands, 90 contacts, 3–5 günlük yeni email örnekleri; farklı task status, root/child ilişkileri, detached brand, note trash ve aynı email'i kullanan iki brand.

Büyütülmüş set: 100 brand, 300 contact, 5.000 message/1.000 thread, 500 note. İlk sayfa 50 thread; scroll/search UI'ı bütün message body'lerini DOM'a yüklemez. Sabit hardware'da ölçülen süreleri raporla; makineye bakmadan garanti ms değeri ilan etme. Aynı veriyle pagination'da eksik/duplicate sonuç olmadığını assert et.

Özel synthetic fixture'lar: Unicode subject/body/name; Reply-To; own-sent reply; Cc/Bcc; duplicate recipients; +tag/dots farklı adresler; malformed headers; HTML-only; büyük body/dosya; source deleted; epoch/clock boundary; history string > JS safe integer; cutoff öncesi thread; provider 401/403/429/5xx; delayed save; disk quota; rename/DB/ack crash.

Her test disposable IndexedDB adı ve temp/keyring namespace kullanır. Production credential test dependency değildir. Native unit testleri keyring'de yalnız rastgele synthetic namespace oluşturur; genel credential listesi okunmaz.

## Zorunlu final komutları

Repo root:
~~~powershell
npm run check
~~~

src-tauri:
~~~powershell
cargo fmt --check
cargo check
cargo test gmail:: --lib
cargo test acceptance:: --lib
~~~

Repository root, önceden atanmış separate CARGO_TARGET_DIR ile:
~~~powershell
npm run tauri -- build --no-bundle --features clients-acceptance --config src-tauri/tauri.clients-acceptance.conf.json
~~~

Gates sequential, exit code hemen kaydedilir. Full source gate failed ise final passed yoktur. Pre-existing warning toplamları baseline ile karşılaştırılır; başarılı komutun warning'i failure diye sunulmaz. Test sayıları koşulan gerçek çıktıdan gelir.

## Final native yürüyüş

1. G1 receipt ve izin süre/kotasını refresh et; mevcut auth adapter değiştiyse ilgili PF proof'larını yeniden üret.
2. Kaynak adayını freeze, final build/exe hash al. App'i görev sahipli PID ile aç, diagnostics namespace değerlerini denetle.
3. Synthetic client/contact/task/note oluştur; Overview/Profile/Conversations/Notes ve eski tablar arası dolaş.
4. Category/client switch sırasında local draft/filter/scroll kaybı yok. Profile için Everything/No Client davranışını doğrula.
5. Hazır sentetik fixture'lardan yeni inbound read/download; Gmail read-state korunur. Yeni mail, reply, reply all, forward'ı final composer UI'dan başlat; receiver observer ile kontrol et. Probe UI'dan send yapmak final feature testinin yerine geçmez.
6. Tray hide sırasında native capture devam eder; gösterince projection uygulanır. Full Quit sonrası worker process kalmaz. Reopen catchup cutoff'u bozmaz.
7. Native test harness ile offline, history expiry, unknown send ve file recovery enjekte et. Fixture transport ayrı acceptance test flag'inde; live sonuç olarak etiketleme.
8. Client/contact silme, detached archive retrieval/relink, disconnect/local retention ve notes restore'u denetle.
9. 1024x700 dahil layout, assistant variants, keyboard/EN/TR/text-size QA.
10. Source fingerprint'i tekrar al; farklıysa ilgili gate'ler stale. Final raporu aynı candidate/exe'den üret.

UI automation imkanı P0/P1'de doğrulanır. Mevcut computer-use/native UI tooling kullanılabilir; yalnız Playwright browser preview final native sonucu sayılmaz. Gerekli native automation mevcut değilse bootstrap sırasında çözülür; P6'da ilk kez keşfedilip kullanıcı beklenmez.

## Kanıt seviyeleri

S = source/type/lint/unit; B = browser preview; N-build = native compilation; N-run = gerçek izole uygulama; L = canlı Gmail. Her report `level` alanı taşır. Bir requirement birden çok seviyeye ihtiyaç duyabilir. Kanıt dosyalarında gerçek email/secret yoktur; synthetic screenshot referansları sabit MEDIA/screenshots yoluna göreli bağlanır.
