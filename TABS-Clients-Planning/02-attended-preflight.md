# Kullanıcı eşliğinde hazırlık — G1

> Tarihsel tam-G1 tanımıdır. Yeni geliştirme kapısı için [SUPERSEDED.md](SUPERSEDED.md) ve paket 2.0'ı kullan.

Bu aşama ana geliştirmeden önce tamamlanır. Bu planı yazmak Google'a bağlanma veya email gönderme izni değildir. P1 başladığında kullanıcı ilgili hesapla hazır bulunur; provider değişiklikleri ve izinli sentetik alıcılar o oturumda belirlenir.

## A. Küçük bootstrap'ın sınırı

P0 baseline'dan sonra parent ile tek native/auth worker şu yeniden kullanılabilir parçaları hazırlar:
- ayrı native identity/config, execution diagnostics ve acceptance-only probe UI;
- aynı production Gmail modüllerinde OAuth, keyring, refresh, profile, fixture read/download ve MIME/send;
- local fixture permit store, restart/checkpoint/dedup probe'ları;
- [başlangıç gate'inin](scripts/Test-LaunchGate.ps1) çağıracağı repo helper: `scripts/clients/Invoke-ClientsReadiness.ps1`.

Bootstrap full Clients UI değildir. Bununla birlikte gerçek read/send/reply/reply-all/forward ve onaylı attachment yolunu sınamalıdır; yalnız OAuth örneği G1 sayılmaz. Adapter/probe kodu P3-B tarafından genişletilir, çöpe atılıp farklı yol yazılmaz.

## B. İzole native kimlik ve build

Sabit acceptance identifier: `com.tabs.clients.acceptance`.
Ayrı feature: `clients-acceptance`; production config değiştirilerek günlük çalıştırma bu profile çevrilmez.

P1 parent'ın oluşturacağı gerçek dosya:
`C:\Users\burak\MOTHER\PROJECTS\TABS-local\src-tauri\tauri.clients-acceptance.conf.json`

Merge config: productName/title “TABS Clients Acceptance”, identifier yukarıdaki değer; bundle.active=false, createUpdaterArtifacts=false, fileAssociations=[]; updater endpoints kapalı/boş. Main window label korunur. WebView dataDirectory effective `%LOCALAPPDATA%\com.tabs.clients.acceptance\webview` olarak native builder ile zorlanır; OS path runtime'da çözülür, config içine genişlemeyen environment placeholder bırakılmaz.

Acceptance feature+identifier birlikte doğrulanır:
- global shortcut registration atlanır; production kısayoluna talip olunmaz;
- updater plugin ve frontend startup/manual update eylemleri kapalı;
- native single-instance acceptance namespace'de; gerçek testte production instance'a focus/argv yönlenmez;
- file-open cold-start ve kayıt association yolları acceptance'ta kapalı;
- tray adı acceptance olarak ayrılır; yalnız o tray'in Quit'i o process'i kapatır;
- assistant testinde sentetik context ve network yerine stub kullanılabilir; kullanıcının mevcut CLI hesapları otomatik çağrılmaz.

Tek build coordinator, PowerShell:
~~~powershell
Set-Location 'C:\Users\burak\MOTHER\PROJECTS\TABS-local'
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'TABS-Clients-Acceptance\cargo-target'
npm run tauri -- build --no-bundle --features clients-acceptance --config 'C:\Users\burak\MOTHER\PROJECTS\TABS-local\src-tauri\tauri.clients-acceptance.conf.json'
if ($LASTEXITCODE -ne 0) { throw 'Native acceptance build failed' }
~~~

Beklenen exe: `%LOCALAPPDATA%\TABS-Clients-Acceptance\cargo-target\release\tabs.exe`. Gerçek Cargo target/architecture farklıysa sonuç tahmin edilmez; parent ledger ve izinli yol contract'ını günceller. İzole exe çalışırken aynı exe üzerine build yazılmaz; yalnız task-owned process kapatılır veya yeni task-owned target dizini kullanılır. CARGO_TARGET_DIR yalnız bu shell'in process environment'ıdır; önceki değeri kaydet ve iş sonunda geri ver.

Startup diagnostics, PII içermeden identifier, PID/exe hash, effective app data/local/config roots, WebView dataDirectory, WebView origin, DB name, credential service ve event-journal roots raporlar. Production profile'da sentinel yazılmaz. Acceptance'a sentetik sentinel yaz, restart sonrası yine sadece acceptance'ta göründüğünü doğrula. IndexedDB origin aynı görünse bile ayrı WebView profile zorunludur; yalnız origin string veya başlık izolasyon kanıtı sayılmaz.

## C. Google hazırlığı

Kullanıcıyla tek oturumda şunlar tespit edilir: Gmail mi Workspace mi; hedef mailbox; mevcut Google Cloud project; Gmail API açık mı; OAuth desktop client; audience; publishing state; test user; gerekiyorsa Workspace admin izni. Değerleri plan klasörüne kopyalama.

OAuth client ayarını private local config/keyring'e al; secret'ı chat, terminal veya screenshotta gösterme. Gerekli scopes yalnız gmail.readonly + gmail.send. Personal-use veya internal-use istisnasının gerçekten geçerli olduğunu console durumuyla kaydet; “tek kullanıcıyım” varsayımıyla bütün hazırlığı atlama. [Restricted-scope gereksinimleri ve istisnalar](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

External Testing ve Gmail scope'larında refresh token yedi günlük olabilir. Publishing/audience sonucu ve varsa expiry'yi açıkça değerlendir; ilk login gelecekteki kesintisiz erişimin kanıtı değildir. [Refresh-token süreleri](https://developers.google.com/identity/protocols/oauth2#expiration).

Ana koşu için parent makul `plannedRunUntilUtc` belirler; bu kullanıcıya deadline taahhüdü değildir. Known expiry bu zamandan en az 24 saat sonraya kalmalı. Süresiz olduğuna dair garanti yazma; expiry bilinmiyorsa sadece uygulanabilir politika değerlendirmesi + hemen yapılan refresh sonucu raporlanır. Reauth'ın koşu içinde öngörülebilir olduğu bir yapı G1'i geçmez.

## D. Canlı test izni ve fixture hazırlığı

Kullanıcı exact adresleri, hangi adreslerin To/Cc/Bcc olabileceğini, synthetic subject/body template'lerini, expiry'yi ve toplam gönderim tavanını onaylar. Önerilen başlangıç: preflight 4 send (new/reply/reply-all/forward), final 4, kontrollü yeniden test için 4; **önerilen 12 sayı onay değildir**. Actual allowedCount yazılmadan send fail-closed.

İzin config'i `app_local_data_dir()/clients/acceptance/private-suite.json` içinde tutulur. Alıcılar, mesaj fixture ID'leri ve sender hesap burada private kalır. Plan receipt'inde yalnız suiteId, config hash, fixture alias, permit ID, remainingCount ve expiresAt vardır. Production müşteri adresleri test alıcısı seçilmez.

Birbirinden ayrı fixture alias'ları:
- A1 sender/test mailbox, B1 kontrollü reply alıcısı, C1 kontrollü üçüncü kişi, H1 kontrollü Bcc.
- F-inbound: B1'den A1'e yeni unread sentetik posta + küçük txt/png ek.
- F-group: A1/B1/C1 görünen alıcılar; Reply-To variation.
- F-new/F-reply/F-reply-all/F-forward: ayrık operation labels ve sabit sentetik marker.
- Eski tarih bağlamı, ambiguity, provider deletion, send-timeout ve 404 recovery çoğunlukla offline fixture ile yapılır; Gmail readonly kapsamını genişletmek için canlı delete yapılmaz.

Kontrollü alıcı tarafındaki gerçek teslim/recipient/Bcc/threading kanıtını kullanıcı eşliğinde kur. Sonraki unattended final test için aynı adreslere yeni sentetik gönderimlerin gerçek teslimini denetleyebilen **önceden yetkilendirilmiş test-only receiver observer** hazırlanır. Gerekirse ayrı fixture hesabının yalnız read credential'ı acceptance private/keyring namespace'de tutulur; production tek-mailbox UI'ına ikinci hesap eklenmez. Aynı native Gmail transport kullanılır. Observer veya kendine gönderimin gerekli recipient/threading kanıtını sağlayan düzenek yoksa G1 pending kalır; “finalde kullanıcıya sorarız” denmez.

İzin defteri send'den önce atomik slot reserve eder. Unknown outcome kotayı tüketir; automatic retry kota veya yetkiyi aşamaz. Revoke/expiry durumunda gerçek email işlemi durur.

## E. Canlı kanıt adımları

| Kanıt ID | Gerçek işlem ve başarılı sonuç |
|---|---|
| PF-OAUTH | System browser consent + native callback; doğru state/PKCE ve scopes. |
| PF-IDENTITY | Profile'dan beklenen mailbox; raporda yalnız alias. |
| PF-RESTART | Acceptance app Quit/reopen; keyring aynı izolasyonda tekrar kullanılabilir. |
| PF-REFRESH | Restart sonrası eski access token kullanmadan gerçek refresh exchange + profile GET; yeniden sign-in yok. |
| PF-READ | Yeni synthetic inbound body ve attachment doğru; asset SHA-256 expected ile aynı. |
| PF-NEW | İzinli new send; receiver gerçek teslimi görüyor. |
| PF-REPLY | Reply-To/hedef ve receiver threading doğru. |
| PF-REPLYALL | Görünen To/Cc, self-exclusion/dedup doğru; recipient gözleminde Bcc sızıntısı yok. |
| PF-FORWARD | Yeni conversation, reply header yok; sadece seçilmiş attachment iletiliyor. |
| PF-READSTATE | UNREAD/label snapshot before/after aynı; TABS yerel okuma ayrı. |
| PF-FRESH | Cutoff öncesi body yok, cutoff sonrası var; tekrar fetch duplicate yok. |
| PF-ISOLATION | Yukarıdaki bütün runtime/storage/process kontrolleri passed. |
| PF-PERMITS | Final suite observer/izin/kota/expiry hazır; başka planlı login gerekmiyor. |

JSON evidence dosyaları yalnız schemaVersion, evidenceId, status, checkedAt, candidateFingerprint, executableSha256, adapterContractVersion, operation/fixture aliases, assertion IDs, asset hashes içerir. Gerçek adres/message body/raw provider response içermez. Evidence dosyalarının hash'leri receipt'e yazılır. Kanıt self-report string olmaktan çıkıp test assertion result ve native operation receipt ile ilişkilendirilmelidir.

## F. Receipt ve executable gate

[Şablon](preflight-receipt.template.json) kopyalanıp `preflight-receipt.json` yapılır; template “passed” olarak elle işaretlenmez. Parent gerçek sonuçları doldurur.

| Alan | Tip / doğrulama |
|---|---|
| status | pending/passed/blocked; passed ancak tüm proof'lar başarılıysa |
| checkedAt | UTC ISO; gate için en fazla 24 saat eski |
| repoCandidateFingerprint | scriptin source fingerprint'i; receipt adayı değişmişse stale |
| isolatedAppIdentity | identifier, absolute executable/config paths, SHA-256, privateRoot; script izinli root'u doğrular |
| isolationChecks | her required check boolean true; gerçek runtime kanıtından |
| mailboxAlias | public-safe alias; gerçek email değil |
| oauthAudienceAndPublishingState | consumer/workspace, internal/external, testing/production, policyResolution; secrets yok |
| requiredScopesVerified | iki scope ve grantsVerified=true |
| refreshAfterRestartVerified | boolean + PF-RESTART/PF-REFRESH evidence |
| credentialValidityAssessment | assessedAt, plannedRunUntilUtc, knownExpiryUtc nullable, noPlannedReauth=true, policyReviewed=true |
| liveReadSendReplyReplyAllForwardResults | her operasyon passed + evidence ID |
| attachmentResult/gmailReadStateUnchanged/freshStartAndDeduplicationResult | passed; ilgili evidence |
| permittedTestSuiteReference | suite alias, private config referansı/hash; actual izin private dosyada |
| adapterContractVersion/adapterFingerprint | CL-C1 + adapter source hash; koşu arası değişirse ilgili canlı test yenilenir |
| evidence | required ID'ler, pakete göreli path ve hash |
| prerequisiteFailures | boş dizi olmadan gate geçmez |

Çalıştırma:
~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning\scripts\Test-LaunchGate.ps1'
~~~

Gate, receipt/hash kontrollerinden sonra P1 helper'ını yeni challenge nonce ile çağırır. Helper aynı native acceptance process'teki current runtime'a dar local command/pipe veya acceptance-only diagnostics komutu üzerinden ulaşır; raw OAuth output dışarı vermez. Gerçek forced refresh + profile read, runtime namespace ve kalan permit kontrolü yapılır. **Bu lightweight check hiçbir email göndermez.** Yeni rapor challenge, timestamp ve exe hash taşır; eski JSON dosyasını tekrar sunmak geçmez.

Helper maksimum 60 s çalışır; 0 success, 2 external auth/provider blocker, 3 stale/isolation/proof failure. Ana gate 0/2 döndürür. Probe henüz yazılmamışsa sonuç blocked'dır. G1 geçtikten sonra P2 contract freeze ve P3 başlayabilir. Sonradan provider erişimi kesilirse bağımsız kaynak işleri ilerler; live acceptance verified sayılmaz.

### P1 helper çıktı sözleşmesi

`Invoke-ClientsReadiness.ps1` parametreleri: `-ExecutablePath`, `-Nonce`, `-OutputPath`, zorunlu `-NoSend`. Parent'ın verdiği executable hash/identifier dışındaki process kullanılmaz. Başlatılan helper process `Start-Process -WindowStyle Hidden` ile açılır; görev sahipli process handle'ı üzerinden en fazla 60 saniye beklenir. Named pipe kullanılıyorsa yalnız current Windows user erişebilir, acceptance instance'a özgüdür ve generic invoke/send yetkisi vermez. Başlangıç callback'i token veya URL loglamaz.

Yeni JSON: `schemaVersion:1`, `status:passed|blocked`, `nonce`, `checkedAt` UTC, `identifier`, `executableSha256`; `isolationChecks` receipt ile aynı 14 boolean alanı; `proof` içinde `forcedRefresh`, `profileRead`, `sameMailbox`, `receiverObserverReady`, `permitAuthorized`, `noSendPerformed`; `permit` içinde `remainingSends` ve `expiresAt`. Başarılı değerler gerçek runtime/provider/permit kontrolünden üretilir. Alanı sabit true yazmak test değildir. Rapor yalnız private OutputPath'e atomik yazılır; stdout gerçek hesap veya provider cevabı içermez. Başarısız helper exit code ve sanitized errorCode üretir; gate bu durumda ana koşuyu açmaz.

Preflight evidence JSON'unda `assertions` zorunlu ve boş olmayan `{id,status}` dizisidir; gate bütün assertion'ların passed olmasını ister. Receipt yalnız bu dosyaları hash ile bağlar. P1 parent, bu protokolün negatif durumlarını synthetic fixture ile test eder: stale nonce/time, yanlış exe/profile, eksik scopes, revocation, permit expiry ve receiver observer eksikliği.
