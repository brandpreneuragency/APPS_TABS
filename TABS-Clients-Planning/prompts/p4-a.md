# P4-A — Profile ve Notes deneyimi

> **Çalıştırma: tarihsel prompt.** Etkin paket için [SUPERSEDED.md](../SUPERSEDED.md) dosyasını oku.

Bu prompt yalnız atanmış bounded paketi yürütür. Repo: C:\Users\burak\MOTHER\PROJECTS\TABS-local.
Tarihsel paket kökü: C:\Users\burak\MOTHER\PROJECTS\TABS-local\TABS-Clients-Planning.

## Girdi ve sınırlar

- Requirement IDs: CL-05–06, UX-01.
- Needs: P3-A, P3-C. Parent ledger'da bunların gereken gate'leri verified değilse bağımlı işi başlatma.
- Owner/role: Worker A — profile/notes. En fazla 3 worker; recursive spawn yok.
- Contract: [CL-C1](../03-contracts.md); parent'ın atadığı güncel hash'i doğrula. Bu prompt ile çelişki varsa parent'a contract change isteği gönder.
- İncelenecekler: records/draft services, clients shell, Composer and AttachmentPreview primitives; contracts 2/3/9.
- Başlangıçta AGENTS.md ve subtree instructions oku, git status --short ve ilgili diff'i incele. Değiştireceğin her dosyayı ve symbol/caller referanslarını oku. Hedef Tauri desktop; browser yalnız preview.
- Exclusive write set: `src/components/clients/profile/`, `src/components/clients/notes/`.
- Test dosyaları sadece kendi write set'inde. Shared types/DB/schema/catalog/registration/dependencies/route değişikliklerini parent'a bildir. Ownership transfer olmadan edit yapma.

## Yapılacak iş

Canonical name/color ve ek profil alanları, kişiler/primary editor, autosave status/retry uygula. Note compose/edit/pin/trash/restore ve draft restart akışını bağla. Attachment import/retain gerçek managed service kullanır. Detached archive panelini records service ile bağla.

Contract inputs: doğrulanmış dependency çıktıları + frozen DTO/schema/error/state machine + synthetic fixtures.
Contract outputs: Profile/Notes tam çalışan slice; slow save sırasında brand switch, failure retry, note restart ve restore testleri.

Client ID/selection korunur; pasif CRM/Forms'a yeni ürün mantığı yazılmaz. Markasız scope müşteri profili/mail inbox haline gelmez. Mail/notes AI bağlamına eklenmez. EN/TR metin anahtarlarını parent'a çift dil olarak gönder.

## Verification ve review

Repo root frontend komutları; Rust komutları src-tauri çalışma dizininde:
- `npm run test -- src/components/clients/profile src/components/clients/notes`
- `npm run typecheck`

Native build komutları yalnız build coordinator tarafından, 02-attended-preflight.md'deki separate CARGO_TARGET_DIR ile çalışır. Worker eşzamanlı native build veya npm full gate başlatmaz. Focused test sonuçlarını kodu yazan kişi kaydeder; parent farklı yazarlı reviewer atar. Parent shared patch'lerini entegre ettikten sonra contract ve ilgili focused tests yeniden geçmeden verified sayma.

Browser/synthetic test, native compile, gerçek isolated UI ve Gmail live kanıtlarını ayrı raporla. Native/live requirement olan bir paket mocks ile tamamlandı sayılamaz. Gerçek müşteri inbox'ına, credential değerlerine veya kullanıcının kurulu app storage'ına gitme. Canlı send yalnız private suite'deki açık recipient/action/count izniyle; fixture observer dışında başka kişiye araçla mesaj gönderme.

## Failure ve recovery

Failed save inputu koru; UI taslağı başka markaya yazma. Contact removal history snapshots'ını değiştirme. Shared service ihtiyacını parent'a ilet.
İlerleme kesilirse ledger'a son verified adım, changed files, devam eden task-owned process, pending operation ve sonraki exact action'ı yazdır. Mevcut checkout'ta devam et; patch'i körlemesine tekrar uygulama.

Branch/worktree/commit/push/stash/reset/clean/restore veya production migration yapma. Kullanıcı WIP'i, silinmiş eski plan ve untracked dosyalar korunur. Secret, gerçek adres/mail body, raw OAuth payload/log/screenshot pakete girmez.

## Completion report

Parent'a: changed/saved file paths; implemented behavior; contract hash; tests + exact exit code/totals/warnings; review findings ve fix evidence; native/live evidence level; remaining blocker; shared integration requests. Gerçekte koşmayan komutu passed yazma.
