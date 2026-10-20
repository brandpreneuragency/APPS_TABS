# CL-C1 — veri, servis ve native sözleşmesi

Durum: uygulanacak sözleşme adayı. Parent P1 bulgularıyla son düzeltmeyi yapıp P2'de hash/sürüm ile dondurur. Consumer'lar sürüm değişimini bağımsız yapamaz.

## 1. Otorite ve transaction sınırı

Canonical client: mevcut `Client.id`. Project ve task ilişkileri aynı kalır. UI selection: `taskStore`. Profil/contact/note/mail/draft: `ZenEditorDB`. Pasif `ZenEditorCRMFormsDB` v2'ye yazılmaz.

Native taraf keyring, Gmail HTTP, durable sync/send journal ve managed dosyaları sahiplenir. Native journal Dexie'nin yerine geçmez; UI'nin askıda olduğu süreyi ve process crash'i güvenle aşmak için recoverable taşıma kaydıdır. Mailin başka bir server/DB kopyası yoktur.

Her mutasyon önce DB transaction'ını tamamlar, sonra Zustand görünümünü ve native mirror'ını günceller. Optimistic UI yalnız revision kontrollü rollback ile kullanılır. UI'nin gösterdiği başarısız input kaybolmaz.

## 2. Şema, IDs ve migration

`src/types/clients.ts` ortak domain tipleri; `src/types/gmail.ts` transport DTO'ları; parent sahipliğinde.
Planlanan additive sürüm **v19**; yürütmede başka migration geldiyse mevcut son sürüm + 1 seçilir. Eski object store'lar kaldırılmaz/null yapılmaz. Boş yeni tablolar eklenir; gerçek email/client seed edilmez. Upgrade testinde eski tablo ve indeksler ayrıca assert edilir.

Alanlarda `id` nanoid/OS random tabanlı kararlı local ID; tarihler UTC epoch milliseconds. Provider ID, historyId, Gmail attachmentId opaktır ve string kalır. Gmail internalDate yalnız validate edilerek ms'ye dönüştürülür. Task.date date-only olarak yerel takvim karşılaştırmasında kalır.

| Tablo ve anahtar/indeks | Zorunlu veri |
|---|---|
| `clientProfiles: clientId` | website?, description?, primaryContactId?, revision, updatedAt |
| `clientContacts: id, clientId, normalizedEmail, [clientId+normalizedEmail]` | name, role?, email?, phone?, createdAt, updatedAt, revision, deletedAt? |
| `clientArchives: clientId, detachedAt` | silinen Client snapshot'ı, detachedAt, reason; ID yeniden üretilmez |
| `clientActors: id` | tek local actor ID, displayName, createdAt; takım yetkisi değil |
| `clientNotes: id, clientId, [clientId+occurredAt], updatedAt, deletedAt` | title, bodyText, kind(call/meeting/decision/note), contactId?, contactSnapshot?, occurredAt, pinned, authorId, revision, createdAt, updatedAt, deletedAt?, detachedAt? |
| `clientDrafts: id, kind, clientId, accountId, updatedAt` | kind note/mail/profile; stable editSessionId, revision, savedAt; tipe özgü taslak, failedSave? |
| `gmailAccounts: id, &providerAccountKey, state` | provider gmail, normalized primary address (private local), displayName?, selfAddresses[], cutoffMs, connectedAt, credentialRef, authEpoch, state, scopes; token yok |
| `gmailThreads: [accountId+threadId], accountId, [accountId+lastMessageAt]` | subject snapshot, participant summaries, lastMessageAt, local unreadCount, hasEarlierContext, remoteAvailability |
| `gmailMessages: [accountId+messageId], [accountId+threadId], [accountId+internalDateMs]` | provider IDs, RFC Message-ID, reply headers, immutable participant snapshots, sent/received time, bodyText, excerpt, direction, sourceAvailable, localReadAt?, provider label snapshot |
| `clientThreadLinks: [accountId+threadId], clientId, state` | single clientId nullable; source auto/manual, state linked/ambiguous/blocked/detached; decisionRevision, candidateClientIds, manual exclusion tombstone |
| `clientAttachments: id, ownerKey, accountId, state` | ownerType note/draft/message, account/message/part/provider attachment ID?, displayName, mime, bytes, digest?, storageKey?, state, retained, operationId |
| `gmailSendAttempts: operationId, draftId, accountId, state` | frozen payload revision/hash, captured client/account/recipients/action/thread, RFC Message-ID, startedAt, state, provider result?, errorCode? |
| `gmailSync: accountId` | cutoffMs, appliedHistoryId, projectionSequence, state, lastSuccessAt, retryAt?, errorCode? |
| `clientOperations: operationId, kind, state` | mutationIdempotency, attachment/native-projection receipt, snapshotVersion, hash, createdAt |

Tek aktif hesap invarianti aynı Dexie transaction'ında kontrol edilir; native taraf da bir aktif account/authEpoch kabul eder. Disconnect olan hesap geçmişiyle kalır. `providerAccountKey`, getProfile sonucu primary adresin normalize edilmiş Gmail kimliğidir; local accountId bunun değişmez karşılığıdır. Aynı adresle reconnect cutoff'u korur. Workspace adresi değişmişse Gmail profile değişmez Google subject sağlamadığından otomatik birleştirme yapılmaz; yeni hesap sayılır ve eski arşiv kalır. Ek OpenID scope v1 için gerekmiyor. [Gmail profile sözleşmesi](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).

Primary contact boolean'ları yerine profilde tek primaryContactId kullanılır. Contact'ın aynı markaya ait ve aktif olması transaction içinde doğrulanır. Silmede primary null olur; rastgele yeni primary seçilmez. Email'i olmayan contact mümkündür; eşleşmeye katılmaz. Aynı markada aynı aktif email için duplicate uyarısı; farklı markalar arasında duplicate mümkündür ve ambiguity üretir.

## 3. Canonical client, autosave, notes ve detachment

Brand name/color mevcut clientStore aracılığıyla yazılır; ikinci ad alanı yaratılmaz. Yeni `saveClientIdentity` result-returning store action'ı veya eşdeğer additive API revision/brand ID yakalar, duplicate-name ve DB hatasını caller'a döndürür. Eski updateClient caller'ları bozulmaz.

Profile/contact/note autosave: blur veya 500 ms debounce; anahtar `entityId+editSessionId`, captured revision ve captured clientId. Navigate olduğunda yeni marka için eski async sonucu uygulanmaz. Yerel taslak her edit ile debounce edilerek saklanır; failed save taslağı silmez. “Kaydediliyor/Kaydedildi/Kaydedilemedi—Tekrar dene” durumu gerçek commit'e bağlıdır. Process kill'in son 500 ms'si dışında yazılmış taslaklar restart'ta gelir; pencere hide sırasında flush edilir. Gönderim yalnız son taslak kaydı bitince mümkündür.

Note body v1 plain text; mevcut Composer textarea/button primitive'leri kullanılır. Not türü ve internal label emailden belirgin ayrılır. Note deletion deletedAt ile reversible; Trash filtresi ve Restore vardır. Pinned yalnız nondeleted notları Overview'e getirir. Author clientActors içindeki local actor'dır.

Client deletion mevcut deleteClient transaction'ını genişletir: arşiv snapshot'ı yaz, contacts/profile/notes/links/drafts için detachedAt veya arşiv referansı kaydet, ardından mevcut project/task/client davranışını uygula. Yeni cascade-delete yok. Native ingest her seferinde client'ın halen varlığını ve archive tombstone'u kontrol eder. Detached draft gönderilemez.

Everything içindeki Ayrılmış kayıtlar filtresi sadece zaten tutulmuş kayıtları listeler; gelen kutusu değildir. Kullanıcı bir mevcut brand seçip “Kayıtları bağla” ile notes/contact/profile ve manual thread linklerini taşıyabilir. Çakışan website/primary otomatik üzerine yazılmaz; mevcut alan korunur, eski değer kurtarma panelinde gösterilir. Otomatik eski client yaratılmaz; task/project geri yükleme bu işlemde yapılmaz. Contact silme soft-delete'dir; message snapshots ve explicit links değişmez.

## 4. Eşleşme ve yerel arama

Adres parse edilir; çevre whitespace temizlenir, domain IDNA+lowercase, ASCII local-part casefold uygulanır. Dots veya +tag çıkarılmaz; display name/domain geneli eşleşmesi yok. Orijinal yazım snapshot'ta kalır. ASCII dışı ad/rol/subject/body korunur. Desteklenmeyen alıcı adres biçimi, taslak silinmeden net validation hatası verir; regex ile sıradan uluslararası isimler reddedilmez.

Inbound From/Reply-To ve visible To/Cc; sent için To/Cc ve mevcut Bcc snapshot'ı taranır; kendi primary ve açıkça kaydedilmiş self alias'ları çıkarılır. Bilinmeyen alias tahmin edilmez. Tam bir brand bulunduysa auto link; birden fazlaysa ambiguous; sıfırsa body saklanmaz.

Thread assignment tekildir:
- Manual link veya manual block/exclusion varsa sonraki sync değiştirmez.
- Yeni auto link için benzersiz brand gerekir.
- Önceden auto-linked thread'e başka markadan katılımcı gelirse conflict/ambiguous olur; aynı thread birden çok marka altında çoğalmaz.
- Contact düzenleme eski linki sessizce taşımaz. Yeni/henüz bağlanmamış post-cutoff mesajlar için bounded reconciliation açılır; eski link için gerekirse review işareti.
- Manual unlink `blocked` tombstone üretir; tekrar sync geri bağlamaz.
- Eşleşmesi belirsiz kayıtların metadata'sı limited review listesinde kalır; body ancak bilinçli brand linkinden sonra indirilir.

Conversations local search: saklanan bodyText, subject ve participant snapshot üzerinde client/account scoped, sayfalı arama; native/server search engine yok. 50 thread/page, 100 message/page. Filtreler contact, zaman aralığı ve **TABS unread** durumudur. Yeni inbound localUnread başlar, yerel okuma sadece localReadAt yazar. Gmail UNREAD yalnız read-only snapshot'tır, Gmail'e modify çağrısı yoktur.

Manual Link modal: 50 metadata sonucu/page, en fazla 5 sayfa/arama; kullanıcı devam için sorguyu daraltır. Uygulama aramaya zorunlu cutoff uygular; ham kullanıcı Gmail query'si sınırı iptal edemez. Sonuç body'leri linklenmeden kalıcı yazılmaz. Thread'in sadece cutoff sonrası mesajları getirilir. [Tarih filtresinde epoch seconds](https://developers.google.com/workspace/gmail/api/guides/filtering).

## 5. UI/service/native API

Component → Zustand action → `src/services/clients/*` veya `src/services/gmail/*` → mevcut runtime detector → dar native command.

Browser adapter `UNSUPPORTED_RUNTIME` döndürür; yalnız geliştirme fixture'ı ve native bağlantı açıklaması vardır. Browser'da Google OAuth veya production fallback yoktur.

Parent P2'de şu portları freeze eder:

| Port | Girdi / çıktı / kural |
|---|---|
| ClientRecordsService | get/saveProfile; upsert/removeContact; save/delete/restore/pinNote; listDetached/relinkArchive. Result + revision; transaction sahibi. |
| ClientsNavigation | enterClients; changeCategory; openExistingTask; openExistingProject. taskStore/uiStore actions kullanır. |
| GmailPort.connect/cancel/status/disconnect | tek account ve authEpoch; token döndürmez; connect sistem tarayıcısını native açar. |
| GmailPort.refresh/publishMatchSnapshot | accountId, versioned contacts/manual decisions; snapshot ack. refresh request coalesced. |
| GmailPort.readEvents/ackEvents | account+epoch+sequence+hash, limit; ack yalnız Dexie projection transaction sonrası. |
| GmailPort.searchLinkCandidates/linkThread | bounded query/cutoff; metadata DTO; link domain transaction ve snapshot publish. |
| GmailPort.prepareSend/submitSend/reconcileSend | frozen revision+operationId, prepare token/hash; native durable ledger; submit tekil. |
| ManagedFilesPort | stageImport, fetchAttachment, retain, readPreview, exportWithDialog; storageKey kullanan typed API. |
| ReadinessPort | yalnız acceptance feature; sanitized runtime diagnostics, fresh refresh/profile probe, protected fixture receipt. |

Tauri command isimleri `gmail_*`, `client_files_*`, `clients_acceptance_*` prefix'leriyle sabitlenir. Rust handler registration ve gerekli custom permission tanımları parent'ta. `src-tauri/capabilities/default.json` mevcut broad FS scope'u Gmail için genişletilmez; yeni native fonksiyonların kendi path/host allowlist'i gerekir.

Error envelope: `{code, retryable, retryAfterMs?, operationId?, userAction?, detailKey}`. Kodlar: AUTH_REQUIRED, AUTH_CANCELLED, AUTH_TIMEOUT, ACCOUNT_MISMATCH, SCOPE_MISSING, OFFLINE, RATE_LIMITED, CURSOR_EXPIRED, SOURCE_MISSING, SEND_UNKNOWN, VALIDATION, CONFLICT, STORAGE_FULL, FILE_UNAVAILABLE, UNSUPPORTED_RUNTIME. Token, raw HTTP body veya gerçek recipient hata loguna koyulmaz.

## 6. OAuth ve bağlantı

Google desktop client, system browser, yalnız 127.0.0.1 random port callback; PKCE S256, tek kullanımlık cryptographic state, 180 s timeout, cancel ve listener cleanup. Code/verifier sadece native memory; OAuth URL ve callback loglanmaz. Google tokenları yalnız Authorization header ile gönderilir. Redirect host değişimi kabul edilmez. [Google desktop akışı](https://developers.google.com/identity/protocols/oauth2/native-app).

Scopes: `gmail.readonly` ve `gmail.send`; consent returned scopes kontrol edilir. Readonly restricted, send sensitive sınıfındadır. Endpoint testleri profile/messages list/get, history, attachments ve send'in seçilen kapsamlarla çalıştığını doğrular; modify/delete/archive/draft API yoktur. [Scope kaynağı](https://developers.google.com/workspace/gmail/api/auth/scopes).

Keyring service `<effective-app-id>.gmail`; account anahtarı opaque local accountId. Refresh token keyring'de, access token native memory'de; refresh lock tekil. OAuth client config private local alanda, client secret gerekiyorsa keyring'de. Refresh yanıtında yeni refresh token yoksa mevcut olan korunur. UI metadata credentialRef içerir, hiçbir secret içermez.

Disconnect scheduler'ı durdurur, authEpoch artırır, in-flight sonuçların yeni hesaba uygulanmasını engeller, yalnız bağlantının keyring entry'sini siler. Cached records/drafts retained. Retry eden eski send request authEpoch mismatch ile reddedilir; hali hazırda provider'a çıkmış istek geri alınmış sayılmaz, kendi account journal'ında reconcile edilir.

## 7. Sync ve native projection

Rust app-lifetime worker kullanılır; 60 s poll, başlangıç/manual/resume trigger, account başına bir job. Request coalescing; read retry 1/2/4/8/30 s jitter, sonra en fazla 5 dk backoff; Retry-After dikkate alınır. 401 bir refresh + bir retry; invalid_grant auth-required; 403 policy/scope sorunu rate-limit'ten ayrılır. Full quit worker'ı durdurur; Windows service/task eklenmez.

İlk başarılı connection:
1. Native cutoffMs'yi kalıcılaştır, H0 profile history baseline al.
2. `after:floor(cutoffMs/1000)-1` ile bounded yeni mesaj taraması; her mesajın internalDateMs >= cutoffMs olmasını kontrol et.
3. Önce metadata ile eşleştir; yalnız eligible mesajda full body al, attachment payload indirme. Gmail full payload'ın inline küçük dosya bytes'ı gelirse saklama; sadece descriptor.
4. H0'dan history delta'yı yakalayarak tarama sırasında gelen mesajları ekle.
5. Her tamamlanmış batch'i native journal'a flush/fsync + atomik manifest rename ile yaz; ancak bundan sonra capturedHistoryId ilerlet.

Native **capturedHistoryId**, durable staged batch'in provider watermark'ıdır. Dexie **appliedHistoryId**, UI transaction'ına geçirilmiş watermark'tır. İkisi aynı şey diye raporlanmaz. UI gizliyken native geçerli snapshot ile sync sürer; React timer gerekmez. UI bridge yeniden açıldığında sequence sırasıyla messages/threads/links/attachments + operation receipt + appliedHistoryId'yi **tek Dexie transaction** içinde upsert eder; sonra native ack gönderir. Ack kaybında replay aynı sonucu verir.

Native journal yalnız matched record body'leri ve bounded ambiguous metadata içerir. Unrelated body/token yoktur. Projection geride kalır ve journal 50 MiB/1000 batch sınırına gelirse scheduler backpressure durumuna geçer; oldest unacked batch silinmez. UI döndüğünde ingest edip sync sürer.

Contact/manual-link snapshot version native'e DB commit sonrası gider. Snapshot transfer koparsa settings'deki pending publication tekrar gönderilir. Native'in stale snapshot yüzünden atladığı yeni contact verisi cutoff'tan bounded reconciliation ile bulunur. UI projection sırasında yeni manual decision revision eski batch kararını geçersiz kılar.

History 404 → cutoff'tan sınırlı full reconciliation + yeni H0 delta; cutoff değişmez. Message GET 404 deleted/unavailable olarak işlenir; transient 429/5xx “silindi” sayılmaz. Page içi hata varsa batch tamamlanmaz veya retry item kalıcılaştırılır; checkpoint o mesajı sessizce atlayamaz. [Gmail sync davranışı](https://developers.google.com/workspace/gmail/api/guides/sync).

Post-cutoff reply eski thread'e gelirse sadece uygun tarihli mesajlar tutulur, `hasEarlierContext=true` ile eksik eski bağlam açıklanır. Remote delete yerel body'yi silmez; sourceAvailable=false. Retained dosya okunur, hiç indirilmemiş ek kurtarılabildiği iddia edilmez.

## 8. Durable send

State: draft → prepared → submitting → sent / failed / outcome-unknown.
UI “sending” prepared+submitting'i kapsar. Offline draft otomatik queue'ya girmez; startup'ta submit yoktur.

Send action frozen accountId/authEpoch/clientId/draftId/revision/recipients/subject/body/attachments/action/thread yakalar. DB attempt kaydından sonra native prepare immutable MIME + digest + stable RFC Message-ID oluşturur ve journal'a flush eder. Submit yalnız bu operationId'yi alır; payload sonradan değiştirilemez. Native submitting durumunu network çağrısından önce kalıcılaştırır. Duplicate click/invoke aynı operation sonucunu döndürür, tekrar HTTP yapmaz.

Success receipt body projection'dan önce native'de kalıcılaşır. Crash durumunda:
- prepared: henüz network yok, kullanıcı send tekrarına karar verir.
- submitting: outcome-unknown; native otomatik tekrar göndermez.
- sent receipt: Dexie projection replay edilir.
- kesin validation/HTTP rejection: failed; draft ve dosyalar korunur.

Unknown için Sent'te stable RFC Message-ID araması ve payload metadata doğrulaması: bulunursa sent; bulunmaması hemen “gönderilmedi” kanıtı değildir. 10 s / 30 s / 2 dk / 5 dk read-only reconcile; hâlâ belirsizse kullanıcıya açık durum ve kopya gönderme riskini anlatan deliberate retry. Yeni attempt yeni operationId taşır ve önceki attempt ile ilişkilidir. Exactly-once garantisi yoktur.

New: görünür To/Cc/Bcc. Reply: hedef mesaj Reply-To, yoksa From; Subject/threadId/RFC headers korunur. Reply all: Reply hedefi + görünen To/Cc, self exclusion ve To>Cc dedup, görünmeyen Bcc tahmin edilmez. Kendi sent mesajına reply varsayılan hedefi o mesajın To'su; boşsa kullanıcı seçer. Forward: yeni thread, yeni Message-ID, reply headers/threadId yok; quote plaintext ve açıkça seçilmiş attachments.

MIME builder CR/LF header injection'ı reddeder, Unicode header/body ve base64url üretir. Bcc yalnız outgoing MIME/envelope üretimi için kullanılır; alıcıda görünmediği controlled testle doğrulanır. [Gönderim](https://developers.google.com/workspace/gmail/api/guides/sending), [Gmail threading şartları](https://developers.google.com/workspace/gmail/api/guides/threads).

## 9. Dosyalar ve güvenli render

Email HTML privileged DOM'a sokulmaz. Body text varsa onu kullan; HTML-only body native parser'ın text dönüşümünden geçer. React text node/pre-wrap; raw HTML, remote image, iframe, script, form ve app IPC yok. Linkler yalnız açık kullanıcı tıklamasıyla http(s), native allowlist wrapper; javascript/file/data URL reddedilir. [mail-parser](https://docs.rs/mail-parser/latest/mail_parser/) ve [mail-builder](https://docs.rs/mail-builder/latest/mail_builder/) bu seçimlerin teknik temelidir.

Storage root `app_local_data_dir()/clients`:
- `attachments/staging/<operationId>.part`
- `attachments/objects/<generatedKey>`
- `gmail/journal/<accountId>/...`
- `gmail/send/<accountId>/<operationId>/...`
- `acceptance/private-suite.json` ve private operational reports.

Filename hiçbir zaman storage path değildir; separators, ADS kolon, device names, traversal ve reparse/symlink escape kontrol edilir. Join ardından canonical root containment; temp/rename aynı disk. MIME/extension'a güvenilmez.

Download explicit; transient cache `downloaded`, “Yerel kopyayı sakla” `retained` yapar. Retained/note/draft dosyası otomatik temizlenmez. Transient cache en fazla 30 gün/250 MiB; aktif preview/send/draft/note referansı veya aktif operation varsa eviction yoktur. Sırf message descriptor'ın bulunması transient cache'i sonsuza dek pinlemez. Kullanıcı transient cache temizliğinde byte kaybı normaldir, metadata sourceAvailable korunur.

Normal sync'te Gmail `format=full` MIME-part JSON'u kullanılır; eklerin tamamını taşıyan `format=raw` indirilmez. Header/charset/text dönüştürme parser ile yapılır. Uygulama metadata'sında provider attachmentId ve partId saklanır; normal attachment payload sadece açık download isteğiyle gelir. Gmail'in full cevabında gömülü küçük inline byte varsa bunlar önizleme/retained dosya haline otomatik getirilmez.

Import/download: native staged write+digest → DB attachment ref transaction → native finalize rename → ready ack. Crash sırasında her iki taraf operationId üzerinden reconcile eder; yok dosya ready diye sunulmaz. Delete tombstone sonrası yalnız unreferenced task-owned staging dosyası temizlenir; blanket cleanup yoktur.

Ürün limitleri: attachment başına 20 MiB, outgoing toplam ham ek 20 MiB, encoded MIME 30 MiB, body 2 MiB; bunlar Gmail'in maksimumu olduğu iddiası değildir. Aşan dosyaya açık hata, draft retained. Büyük inbound metadata okunur; limitli attachment indirilemez. Güvenli preview yalnız düz metin ve decode edilen PNG/JPEG/WebP; HTML/SVG/PDF/diğer dosyalar export action, otomatik execute yok. [HTTP katmanı](https://docs.rs/reqwest/latest/reqwest/) native request timeout/redirect/size limitlerini uygular.

## 10. Overview ve shell

Latest discussions gerçek excerpt, contact, subject ve date içerir; en yeni 5 linked thread. Pinned nondeleted notes; New email/Add note explicit brand ister.

Current work: active project = en az bir nondeleted pending/in_progress task içeren proje. “Açık işler” sayısı nondeleted root task aileleridir: root veya yaşayan bir child açıksa aile bir kez sayılır. Ayrı subtask sayısı “alt görev” etiketiyle verilebilir; toplamla toplanmaz. Root silinmiş fakat child yaşayan bozuk fixture ayrı orphan root sayılır ve görünür recovery uyarısı alır. Date-only overdue mevcut yerel günle karşılaştırılır. Task ve project state değişince selector güncellenir.

Task link açma: gerçek project/client resolve → mevcut taskStore selection ve activeTask → Task List. Project link: mevcut Projects route + client/project selection. Yeni task detail ekranı yapılmaz.

ClientsView state activeCategory + account/client/category keyed search/filters/scroll/threadId içerir. Draft DB'de; category component unmount olsa bile kaybolmaz. Profile invalid aggregate scope'ta disabled/açıklamalı; Profile'dan Everything'e geçiş Overview'e döner. No Client profil/not/mail inbox üretmez; current work ve açıklama gösterir. Assistant binding aynı kalır; mail/notes yeni AI context/source listelerine eklenmez.
