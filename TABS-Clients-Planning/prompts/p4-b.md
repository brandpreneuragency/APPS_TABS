# P4-B — Conversations ve email composer

> **Çalıştırma: tarihsel prompt.** Etkin paket için [SUPERSEDED.md](../SUPERSEDED.md) dosyasını oku.

Bu prompt yalnız atanmış bounded paketi yürütür. Repo: C:\Users\burak\MOTHER\PROJECTS\TABS-local.
Tarihsel paket kökü: C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning.

## Girdi ve sınırlar

- Requirement IDs: GM-02–04, GM-06–08, UX-01.
- Needs: P3-A, P3-B, P3-C. Parent ledger'da bunların gereken gate'leri verified değilse bağımlı işi başlatma.
- Owner/role: Worker B — conversations. En fazla 3 worker; recursive spawn yok.
- Contract: [CL-C1](../03-contracts.md); parent'ın atadığı güncel hash'i doğrula. Bu prompt ile çelişki varsa parent'a contract change isteği gönder.
- İncelenecekler: GmailPort, records/draft services, contracts 4–9, P1 fixtures.
- Başlangıçta AGENTS.md ve subtree instructions oku, git status --short ve ilgili diff'i incele. Değiştireceğin her dosyayı ve symbol/caller referanslarını oku. Hedef Tauri desktop; browser yalnız preview.
- Exclusive write set: `src/components/clients/conversations/`, `src/components/clients/composer/`.
- Test dosyaları sadece kendi write set'inde. Shared types/DB/schema/catalog/registration/dependencies/route değişikliklerini parent'a bildir. Ownership transfer olmadan edit yapma.

## Yapılacak iş

Tek center panelde list→thread→back ve scroll restore, local search/unread/contact/date filters kur. Mailbox connect/status/disconnect; bounded manual link/correct/ambiguity UI bağla. New/Reply/Reply all/Forward, local drafts, explicit Send, visible sender/recipients, unknown state ve attachment controls uygula. Browser connect unsupported state olsun.

Contract inputs: doğrulanmış dependency çıktıları + frozen DTO/schema/error/state machine + synthetic fixtures.
Contract outputs: Mock olmayan adapter entegrasyonu; recipient/mode clarity, no blind resend, plaintext safety ve attachment availability UI testleri.

Client ID/selection korunur; pasif CRM/Forms'a yeni ürün mantığı yazılmaz. Markasız scope müşteri profili/mail inbox haline gelmez. Mail/notes AI bağlamına eklenmez. EN/TR metin anahtarlarını parent'a çift dil olarak gönder.

## Verification ve review

Repo root frontend komutları; Rust komutları src-tauri çalışma dizininde:
- `npm run test -- src/components/clients/conversations src/components/clients/composer`
- `npm run typecheck`

Native build komutları yalnız build coordinator tarafından, 02-attended-preflight.md'deki separate CARGO_TARGET_DIR ile çalışır. Worker eşzamanlı native build veya npm full gate başlatmaz. Focused test sonuçlarını kodu yazan kişi kaydeder; parent farklı yazarlı reviewer atar. Parent shared patch'lerini entegre ettikten sonra contract ve ilgili focused tests yeniden geçmeden verified sayma.

Browser/synthetic test, native compile, gerçek isolated UI ve Gmail live kanıtlarını ayrı raporla. Native/live requirement olan bir paket mocks ile tamamlandı sayılamaz. Gerçek müşteri inbox'ına, credential değerlerine veya kullanıcının kurulu app storage'ına gitme. Canlı send yalnız private suite'deki açık recipient/action/count izniyle; fixture observer dışında başka kişiye araçla mesaj gönderme.

## Failure ve recovery

Uncertain send ekranını success'e çevirmeme; draft preserved. Live test yalnız mevcut permit kapsamında; izin bitince durdur ve parent'a bildir.
İlerleme kesilirse ledger'a son verified adım, changed files, devam eden task-owned process, pending operation ve sonraki exact action'ı yazdır. Mevcut checkout'ta devam et; patch'i körlemesine tekrar uygulama.

Branch/worktree/commit/push/stash/reset/clean/restore veya production migration yapma. Kullanıcı WIP'i, silinmiş eski plan ve untracked dosyalar korunur. Secret, gerçek adres/mail body, raw OAuth payload/log/screenshot pakete girmez.

## Completion report

Parent'a: changed/saved file paths; implemented behavior; contract hash; tests + exact exit code/totals/warnings; review findings ve fix evidence; native/live evidence level; remaining blocker; shared integration requests. Gerçekte koşmayan komutu passed yazma.
