# Implementation plan

## Sonuç ve kapsam

Docs / Task List / Calendar / Projects yanına Clients eklenecek. Soldan sağa mevcut marka navigasyonu, Overview–Profile–Conversations–Notes kategori paneli, kategori içeriği ve mevcut assistant yer alacak. Kullanıcı son görüşmeleri ve mevcut işleri aynı marka kimliğinde görecek.

Bu plan bütün briefing kapsamını içerir: gerçek Gmail bağlantısı, okuma/arama, New/Reply/Reply all/Forward, ekler, yerel taslaklar, notlar, kayıt koruma, yaşam döngüsü ve izole native kabul. Yeni AI bağlamı, toplu gönderim, takım, başka mesajlaşma sağlayıcısı veya sunucu eklenmez.

## İncelenen güncel temel

27 Eylül incelemesinde HEAD `c4efee2`, package 1.1.3, ana Dexie sürümü 18 ve CRM/Forms sürümü 2 görüldü. Bunlar P0'da tekrar doğrulanır.

| Kaynak | Doğrulanan durum ve plan etkisi |
|---|---|
| `src/components/header/ModeNavigation.tsx` | Dört ana sekme var. Clients, Projects sonrasına eklenir. |
| `src/components/layout/CRMWorkspace.tsx` | Projects özel render ediliyor; Clients render'ı eksik. Yeni ClientsWorkspace buradan açılır. |
| `src/App.tsx` | CRM için CRMListPanel seçiliyor. Sadece Clients route'unda yeni kategori paneli seçilir. |
| `src/components/layout/LeftNarrowSidebar.tsx` | Clients'ta Everything/No Client gizleniyor. Bu özel gizleme kaldırılır; legacy More yalnız yeni Clients'ta gizlenir. |
| `src/stores/uiLayoutState.ts`, `AppLayout.tsx` | CRM context paneli Clients'ta zaten kullanılabilir. Yeni workspace mode eklenmez. |
| `clientStore.ts` | Client oluşturma General project de oluşturuyor. Profil bu client ID'ye bağlanır. |
| `clientStore.ts`, `projectStore.ts` | Client silme task'ları soft-delete ve project/client'ı hard-delete ediyor. İşlem aynı transaction içinde arşiv detachment ile genişletilir. |
| `clientOverview.ts` | Mevcut sayaç parent/subtask ayrımı yapmıyor. Yeni Overview için ayrı, testli selector yazılır; eski ekranların sayacı değiştirilmez. |
| `taskAssistantBinding.ts` | Clients route'unda client/project scope mevcut. Girişte project seçimini temizlemek assistant'a da marka scope verir. |
| `src-tauri/src/lib.rs`, `tray.rs` | Kapatma hide, tray Quit exit. Native sync app ömrüne bağlanır. |
| `src-tauri/src/commands/secrets.rs` | Keyring service config identifier'dan geliyor. Gmail'e özel dar API eklenir; legacy cleanup genişletilmez. |
| `src/services/updater.ts` | Başlangıçta update check var. İzole modda hem native updater hem frontend çağrıları etkisizleştirilmelidir. |
| `src/services/codex/migration.ts` | Yerel bir defalık migration backup yolu var; genel backup ürünü değil. Yeni tabloları toplayabildiği sentetik fixture ile doğrulanır; mail dosyaları otomatik tam backup sayılmaz. |

Çalışma ağacında eski `tabs_crm_forms_plan_package/` paketinin 25 tracked silinmesi ve briefing dahil untracked dosyalar var. Silinmiş plan geri getirilmez. Kaynak kodda tracked diff görülmedi. Tarihsel 334 test sonucu bu planın güncel doğrulama sonucu değildir.

## Ürün ve teknik kararlar

1. Clients'a dışarıdan yeni giriş Overview açar; içeride marka değişimi geçerli kategoriyi korur. Everything aggregate Overview/Conversations/Notes sunar. Profile ve yeni kayıt açık marka ister. No Client yalnız atanmış markası olmayan işi gösterir.
2. `useTaskStore.setSelection(clientId, null)` tek marka selection otoritesidir. Clients içindeki state yalnız kategori, yerel filtre, scroll, seçili thread ve taslak anahtarlarını taşır.
3. Mevcut Client.name/color kanoniktir. Profil tablosu website/description ve primaryContactId tutar. Primary contact tek bir referans olduğu için birden çok primary oluşmaz.
4. Kayıtlar ana Dexie'de; native journal yalnız dayanıklı taşıma, gönderim ve dosya kurtarma içindir. Kanonik entity deposu sayılmaz. [Sınır ve replay protokolü](03-contracts.md).
5. Yeni client veya contact silinmesi yazışma/not içeriğini silmez. Everything altında normal akışa karışmayan “Ayrılmış kayıtlar” filtresinden kayıtlar okunabilir ve mevcut markaya açıkça bağlanabilir.
6. Tek mailbox ve Gmail primary sender. Send-as alias yönetimi kapsam dışı; bilinen kendi adres alias'ları özel hesap ayarında yalnız self-exclusion için tutulabilir.
7. V1 plaintext email ve mevcut Composer/AttachmentPreview primitive'leri kullanılır. Yeni document editor veya HTML email görüntüleyicisi yapılmaz.
8. Ağ ve OAuth Rust'tadır. UI'dan keyring okuma, generic HTTP veya arbitrary dosya yolu çağrısı verilmez.
9. Sağlayıcı kimlikleri/history cursor string, zamanlar UTC epoch ms; task due-date mevcut date-only semantiğiyle kalır.
10. Yeni bağımlılıklar parent tarafından P1'de pinlenir: native HTTP için `reqwest`, MIME header/body için `mail-parser`, gönderim için `mail-builder`, OS randomness için `getrandom`, URL için `url`. Mevcut base64/sha2/keyring/serde/tempfile kullanılır. Windows browser açma mevcut windows-sys üzerinden dar wrapper ile yapılır. Rust MSRV, lisans, lockfile ve API uyumluluğu doğrulanmadan sürüm seçimi tamamlandı sayılmaz. Frontend dependency eklemek başlangıçta gerekli değil.

## Aşamalar ve çıkış kapıları

| Aşama | İş ve bağımlılık | Çıkış |
|---|---|---|
| P0 | Güncel repo, instructions, diff, processes ve baseline. Salt okunur işler paralelleştirilebilir. | Kaynak haritası, baseline sonucu, kullanıcı WIP envanteri, gerçek build/runtime kabiliyeti. |
| P1 | P0 sonrası küçük native bootstrap, isolation, aynı Gmail adapter/probe, Google setup ve kullanıcı eşliğinde canlı sentetik testler. | G1 receipt passed; token refresh/restart, gönderim türleri, alıcı izinleri ve izolasyon kanıtlı. |
| P2 | P1'de kanıtlanan CL-C1 sözleşmesini, indeksleri, fixture'ları ve sahipliği freeze et. | G2 bağımsız authentication/isolation/persistence incelemesi; her consumer aynı contract hash. |
| P3-A | Yerel kayıtlar, migration, transaction, drafts, native projection bridge. | Focused tests ve persistence review. |
| P3-B | Native sync, matching snapshot, send ledger, attachment recovery; P1 adapter'ı genişlet. | Rust tests ve native bridge entegrasyonu. |
| P3-C | Clients shell ve kategori/UI state altyapısı. | Navigation tests ve mevcut kabukla entegrasyon. |
| P4-A | P3-A/C sonrası Profile ve Notes. | Autosave, primary, delete/restore, restart fixture'ları. |
| P4-B | P3-A/B/C sonrası Conversations, composer, attachment ve account UX. | Gerçek adapter ile tüm email akışı; mock-only çıkış kabul edilmez. |
| P4-C | P3-A/C sonrası Overview, mevcut work bağlantıları ve navigasyon regresyonu. | Güncel iş sayımı ve çapraz sekme testleri. |
| P5 | Bütün P4 ve P3-B sonrası lifecycle, recovery, localization, accessibility, review. | Kritik bulgu yok; candidate freeze. |
| P6 | Bütün yazarlar durur. Full gates, no-bundle build, tamamlanmış izole UI ve sınırlı canlı suite. | Aynı candidate için source/native/live kanıtları. |
| P7 | Dosyalar, storage/migration, tam komut sonuçları, executable ve sınırlamalar. | Teslim seviyesi A raporu; installed app değişmediği kanıtı. |

P3 üç worker slotunu kullanır. Parent shared dosyaları entegre eder. P4 ancak ilgili producer'lar doğrulanınca açılır. Bağımsız reviewer serbest worker slotunu alır; kendisinin yazdığı parçaya tek başına kabul vermez. Runtime agent sağlamıyorsa aynı paketler sırayla yürür.

## Riskler ve planlanan çözüm

- **Google hazır değil:** P1'de çöz; açık kullanıcı işi varken ana koşuyu başlatma.
- **Tray'de WebView timer durur:** scheduler Rust'ta, dayanıklı native batch journal, Dexie ack sonrası temizleme. UI geri geldiğinde replay.
- **Send cevabı kaybolur:** operation ledger ve outcome-unknown; otomatik resend yok.
- **DB–filesystem atomik değil:** generated key, staged dosya, prepare/commit/ack, başlangıçta reconciliation.
- **Client silinirken sync gelir:** tombstone/detached kontrolü ingest transaction'ında; silinmiş markayı yaratma.
- **Existing baseline bozuk:** sonucu ayrı kaydet; gate'i yeşil göstermeden bağımsız işleri sürdür. Kapsam dışı büyük onarım sessizce yapılmaz.
- **İzole build production ayarlarını devralır:** effective identifier, WebView profile, storage origin, keyring, updater, hotkey, single-instance ve process yolları gerçek çalışmada test edilir.

## Bitiş tanımı

[05-acceptance.md](05-acceptance.md) içindeki her requirement için packet, test ve kanıt tamamlanmış; `npm run check`, Rust gates ve native/live kabul aynı source fingerprint ile başarılı olmalıdır. Gmail bağlantısı, preflight probe veya yalnız derleme tam modül kabulü yerine kullanılamaz. Üretim kurulumu ayrı bir gelecekteki iş olarak kalır.
