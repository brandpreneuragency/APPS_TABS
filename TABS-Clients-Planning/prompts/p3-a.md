# P3-A — Yerel kayıt ve persistence foundation

> **Çalıştırma: tarihsel prompt.** Etkin paket için [SUPERSEDED.md](../SUPERSEDED.md) dosyasını oku.

Bu prompt yalnız atanmış bounded paketi yürütür. Repo: C:\Users\burak\MOTHER\PROJECTS\TABS-local.
Tarihsel paket kökü: C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning.

## Girdi ve sınırlar

- Requirement IDs: CL-03, CL-05–06, GM-02, GM-05–07, OP-01.
- Needs: P2. Parent ledger'da bunların gereken gate'leri verified değilse bağımlı işi başlatma.
- Owner/role: Worker A — data/state. En fazla 3 worker; recursive spawn yok.
- Contract: [CL-C1](../03-contracts.md); parent'ın atadığı güncel hash'i doğrula. Bu prompt ile çelişki varsa parent'a contract change isteği gönder.
- İncelenecekler: db.ts; clientStore/projectStore/taskStore; contracts 1–4/7/9; codex migration backup helper.
- Başlangıçta AGENTS.md ve subtree instructions oku, git status --short ve ilgili diff'i incele. Değiştireceğin her dosyayı ve symbol/caller referanslarını oku. Hedef Tauri desktop; browser yalnız preview.
- Exclusive write set: `src/services/clients/records/`, `src/stores/clientRecordsStore.ts`, `src/stores/clientRecordsStore.test.ts`, `src/stores/clientDraftStore.ts`, `src/stores/clientDraftStore.test.ts`.
- Test dosyaları sadece kendi write set'inde. Shared types/DB/schema/catalog/registration/dependencies/route değişikliklerini parent'a bildir. Ownership transfer olmadan edit yapma.

## Yapılacak iş

Profile/contact/note/actor repositories, versioned save results, durable drafts ve primary invariant kur. Native projection transaction/receipts/replay, detachment/relink, local read/search ve attachment finalize orchestration uygula. Parent'tan canonical delete/update hooks iste. Main DB ve passive companion preservation fixture'ı yaz.

Contract inputs: doğrulanmış dependency çıktıları + frozen DTO/schema/error/state machine + synthetic fixtures.
Contract outputs: Gerçek Dexie servisleri, migration/replay/failure testleri, parent hook patch specification. Native DTO mockları contract fixtures ile aynı.

Client ID/selection korunur; pasif CRM/Forms'a yeni ürün mantığı yazılmaz. Markasız scope müşteri profili/mail inbox haline gelmez. Mail/notes AI bağlamına eklenmez. EN/TR metin anahtarlarını parent'a çift dil olarak gönder.

## Verification ve review

Repo root frontend komutları; Rust komutları src-tauri çalışma dizininde:
- `npm run test -- src/services/clients/records src/stores/clientRecordsStore.test.ts src/stores/clientDraftStore.test.ts`
- `npm run typecheck`

Native build komutları yalnız build coordinator tarafından, 02-attended-preflight.md'deki separate CARGO_TARGET_DIR ile çalışır. Worker eşzamanlı native build veya npm full gate başlatmaz. Focused test sonuçlarını kodu yazan kişi kaydeder; parent farklı yazarlı reviewer atar. Parent shared patch'lerini entegre ettikten sonra contract ve ilgili focused tests yeniden geçmeden verified sayma.

Browser/synthetic test, native compile, gerçek isolated UI ve Gmail live kanıtlarını ayrı raporla. Native/live requirement olan bir paket mocks ile tamamlandı sayılamaz. Gerçek müşteri inbox'ına, credential değerlerine veya kullanıcının kurulu app storage'ına gitme. Canlı send yalnız private suite'deki açık recipient/action/count izniyle; fixture observer dışında başka kişiye araçla mesaj gönderme.

## Failure ve recovery

DB quota/failed transaction eski kaydı korur; taslak silinmez. Partial file stage operationId ile resume. Live DB okumaz.
İlerleme kesilirse ledger'a son verified adım, changed files, devam eden task-owned process, pending operation ve sonraki exact action'ı yazdır. Mevcut checkout'ta devam et; patch'i körlemesine tekrar uygulama.

Branch/worktree/commit/push/stash/reset/clean/restore veya production migration yapma. Kullanıcı WIP'i, silinmiş eski plan ve untracked dosyalar korunur. Secret, gerçek adres/mail body, raw OAuth payload/log/screenshot pakete girmez.

## Completion report

Parent'a: changed/saved file paths; implemented behavior; contract hash; tests + exact exit code/totals/warnings; review findings ve fix evidence; native/live evidence level; remaining blocker; shared integration requests. Gerçekte koşmayan komutu passed yazma.
