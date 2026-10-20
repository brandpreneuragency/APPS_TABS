# P3-B — Native Gmail sync/send/files foundation

> **Çalıştırma: tarihsel prompt.** Etkin paket için [SUPERSEDED.md](../SUPERSEDED.md) dosyasını oku.

Bu prompt yalnız atanmış bounded paketi yürütür. Repo: C:\Users\burak\MOTHER\PROJECTS\TABS-local.
Tarihsel paket kökü: C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning.

## Girdi ve sınırlar

- Requirement IDs: GM-01–08, OP-01–02.
- Needs: P2. Parent ledger'da bunların gereken gate'leri verified değilse bağımlı işi başlatma.
- Owner/role: Worker B — native/Gmail. En fazla 3 worker; recursive spawn yok.
- Contract: [CL-C1](../03-contracts.md); parent'ın atadığı güncel hash'i doğrula. Bu prompt ile çelişki varsa parent'a contract change isteği gönder.
- İncelenecekler: P1 adapter/proof; contracts 5–9; native lifecycle and capabilities.
- Başlangıçta AGENTS.md ve subtree instructions oku, git status --short ve ilgili diff'i incele. Değiştireceğin her dosyayı ve symbol/caller referanslarını oku. Hedef Tauri desktop; browser yalnız preview.
- Exclusive write set: `src-tauri/src/gmail/`, `src/services/gmail/`, `src/stores/gmailStore.ts`, `src/stores/gmailStore.test.ts`.
- Test dosyaları sadece kendi write set'inde. Shared types/DB/schema/catalog/registration/dependencies/route değişikliklerini parent'a bildir. Ownership transfer olmadan edit yapma.

## Yapılacak iş

Native scheduler, snapshot matching, post-cutoff sync, history recovery ve durable projection journal tamamla. Immutable MIME/send ledger, unknown reconcile ve permit enforcement kur. Managed storage key/path checks, attachment lifecycle, service adapters ve browser unsupported path uygula. P1 auth/refresh code yolunu koru.

Contract inputs: doğrulanmış dependency çıktıları + frozen DTO/schema/error/state machine + synthetic fixtures.
Contract outputs: Gerçek Gmail transport+native lifecycle; restart/retry/crash fixture proof; P3-A bridge ile gerçek integration. Güvenlik reviewer bulguları.

Client ID/selection korunur; pasif CRM/Forms'a yeni ürün mantığı yazılmaz. Markasız scope müşteri profili/mail inbox haline gelmez. Mail/notes AI bağlamına eklenmez. EN/TR metin anahtarlarını parent'a çift dil olarak gönder.

## Verification ve review

Repo root frontend komutları; Rust komutları src-tauri çalışma dizininde:
- `cargo test gmail:: --lib`
- `npm run test -- src/services/gmail src/stores/gmailStore.test.ts`
- `cargo fmt --check`
- `cargo check`

Native build komutları yalnız build coordinator tarafından, 02-attended-preflight.md'deki separate CARGO_TARGET_DIR ile çalışır. Worker eşzamanlı native build veya npm full gate başlatmaz. Focused test sonuçlarını kodu yazan kişi kaydeder; parent farklı yazarlı reviewer atar. Parent shared patch'lerini entegre ettikten sonra contract ve ilgili focused tests yeniden geçmeden verified sayma.

Browser/synthetic test, native compile, gerçek isolated UI ve Gmail live kanıtlarını ayrı raporla. Native/live requirement olan bir paket mocks ile tamamlandı sayılamaz. Gerçek müşteri inbox'ına, credential değerlerine veya kullanıcının kurulu app storage'ına gitme. Canlı send yalnız private suite'deki açık recipient/action/count izniyle; fixture observer dışında başka kişiye araçla mesaj gönderme.

## Failure ve recovery

Transient read bounded retry; external auth failure ayrı. Send için blind retry yok. Journal ack gelmeden prune edilmez. Adapter değişimi ilgili P1 kanıtını stale yapar.
İlerleme kesilirse ledger'a son verified adım, changed files, devam eden task-owned process, pending operation ve sonraki exact action'ı yazdır. Mevcut checkout'ta devam et; patch'i körlemesine tekrar uygulama.

Branch/worktree/commit/push/stash/reset/clean/restore veya production migration yapma. Kullanıcı WIP'i, silinmiş eski plan ve untracked dosyalar korunur. Secret, gerçek adres/mail body, raw OAuth payload/log/screenshot pakete girmez.

## Completion report

Parent'a: changed/saved file paths; implemented behavior; contract hash; tests + exact exit code/totals/warnings; review findings ve fix evidence; native/live evidence level; remaining blocker; shared integration requests. Gerçekte koşmayan komutu passed yazma.
