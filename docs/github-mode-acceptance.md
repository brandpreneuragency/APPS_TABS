# TABS GitHub Mode — yönetici teslim ve kabul kaydı

- **Model:** openai-codex / gpt-6.1-sol-900k / reasoning high
- **Karar:** VERIFIED WITH DEFERRED ITEMS — izinli kaynak/frontend teslimi tamamlandı. Windows native ve canlı GitHub doğrulaması yapılmış değildir.
- **Kabul tarihi:** 2026-10-06 UTC
- **Proje:** `/home/admin/ATLAS/DEV/TABS`
- **Kaynak plan:** `brandpreneuragency/atlas-plans`, `26-10-05-07.19-TABS-GitHub-Mode/PLAN.md`, commit `0c77bea0eeef12c22cf2ab74c1bfcbd4be9a3564`.

## Kaynak, yetki ve yürütme

- r2 yalnız model/yol/bitirme yetkisini güncelledi; r1 ürün, UI, mimari ve üç faz uygulandı.
- Başlangıç ve teslim HEAD: `fdf1af2f8e5c66e60136bc34b18be4bef33a289f`, `main`. Teslimde `git ls-remote origin refs/heads/main` aynı hash'i döndürdü. Eski hash'e reset yapılmadı.
- PLAN blob'u `059c649fb296af77adb047a5efa024c5973f3fbd`: sabit commit'teki kaynak ile yerel PLAN eşit.
- Kod yerel çalışma ağacındadır; **TABS commit/push, deploy veya installer yok**. Windows kirli ağacı kopyalanmadı. Kirli PLANS üzerinde pull/reset/clean yapılmadı. Yerel STATE.json gönderilmedi.
- Her faz Strong → Light sırasıyla ve aynı anda yalnız tek uygulayıcıyla yürütüldü. Strong: `xai-oauth / grok-4.7 / high`; Light: `openai-codex / gpt-6-luna / max`. Gerçek model ve reasoning session metadata/usage ile kontrol edildi. Fallback veya iç içe yönetici/reviewer yok.
- Bir birleşik yönetici incelemesi ve **iki** blocker düzeltme turu kullanıldı. İkinci turun çekirdek ve UI dilimleri aynı düzeltme turudur; üçüncü tur yapılmadı.

## Üç faz ve kapsam kanıtı

| Faz / zorunlu davranış | Uygulama ve gerçek doğrulama |
| --- | --- |
| **F1:** ayrı GitHub modu, kurulum/Device Flow, kişisel repo ve branch gezme | `src/components/github/`, `src/services/github/`, `githubStore.ts`; ModeNavigation/UI layout testleri. Browser'da sahte auth veya production fixture fallback yok. |
| **F1:** aç → düzenle → yerel taslak kaydet → repo değiştir → store/app yeniden aç → aynı taslağı oku | Rendered `GithubWorkspace.test.tsx` ve `service.test.ts`; explicit GitHub fixture + **gerçek izole Dexie/fake-indexeddb**. Canlı GitHub değil. |
| **F1:** migration ve hesap/repo/branch/path izolasyonu, logout private cache, iptal/geç cevap | `persistence.test.ts`, `service.test.ts`, `reviewFixes.test.ts`; eski v19 DB verisi korunur. Draft kimliği stable account/repo ID ve ref/path'e bağlıdır. Logout private cache'i kapatır; draft silme ayrı karardır. |
| **F2:** yeni dosya/klasör, upload/drop, binary, taşı/yeniden adlandır/sil, açık geri al | Store/service ve rendered workspace testleri. Boş klasör açık `.gitkeep` taslağıyla temsil edilir; symlink/submodule/LFS normal dosya gibi takip edilmez. Binary byte'ları ve executable mode korunur. |
| **F2:** kaynak/Markdown preview/görsel/PDF, side-by-side ve inline diff, history/commit detail, branch oluştur/değiştir | `GithubWorkspace.tsx`/CSS, rendered workspace testleri ve ilgili core testler. Preview pasiftir; active HTML/SVG iframe sandbox/CSP sınırındadır. Yerel Docs state'inden ayrı repo/ref layout kullanılır. |
| **F2:** seçili dosyalar için tek atomik commit; boş repo/ilk branch | `phase2.test.ts`, `gitPack.test.ts` ve rendered multi-file first-commit testi. Normal akış tek Git tree/commit + `force=false` ref update; tek dosya boş repo bootstrap Contents, çoklu dosya bootstrap bir smart-HTTP receive-pack. Stock Git ile ASCII/Unicode pack/framing interoperability bağımsız production probe'larında geçti. Ürün runtime'ı Git CLI/klon gerektirmez. |
| **F2:** dirty refresh, eski base'i koruma, üç yönlü conflict, delete/edit/rename/binary | `phase2.test.ts`, workspace base/mine/remote ve unresolved commit-block testi. Binary otomatik text merge olmaz; açık sürüm seçimi gerekir. |
| **F2:** CAS, in-flight yeni edit/seçilmemiş draft korunması, ref yarışı, belirsiz sonuçta kör retry yok | Gerçek Dexie concurrent CAS/ack testleri, `reviewFixes.test.ts`, `phase2.test.ts` ve bağımsız manager production probe'ları. Commit cleanup yalnız doğrulanmış gönderilen edit sürümünü siler. |
| **F2:** 401/403/404/409/422/429/5xx, protected branch, pagination/truncated search | Core/policy/phase2 testleri; error mapping, auth expiry, timeout/cancel, safe pagination. Tree/blob + draft overlay arama sınır/ilerleme ve incomplete durumunu açık gösterir. |
| **F2:** AI file/diff review, commit suggestion ve taslak edit; private opt-in, geçmiş/attachment egress ve revoke | `aiEgress.provider.test.ts`, `useStreamingChat.github.test.tsx`, workspace testleri ve production provider probes. Gerçek provider dispatch fonksiyonları test IPC ile kullanılır: izinsiz private içerik/geçmiş/attachment gönderimi engellenir; explicit consent positive path ve queued revoke negative path geçer. Harici AI isteği yapılmadı. AI mutasyonları exact-target onayını atlamaz. |
| **F3:** repo oluşturma, private varsayılan/public/README/gitignore/license | `lifecycle.test.ts` ve rendered create form testi; intent/owner/id/privacy readback, boş repo ve belirsiz create sonucu. |
| **F3:** kalıcı silme, tam owner/repo yazılı onay, ayrı delete_repo yükseltmesi, authenticated readback | Lifecycle ve rendered danger-dialog testleri; yanlış hedefte DELETE yok, auth/error 404 başarı sayılmaz. Yerel repo sekmesi kapatma uzak silme değildir. |
| **F3:** secure storage/native transport/OAuth | Rust command/helper source, production registration ve değişmemiş capability dosyası incelendi. Token/device secret JS/IndexedDB/loga verilmez; sabit OS browser device URL, host/redirect/media/byte guardları. 20 native command'ın tamamı kayıtlı. Windows yürütmesi **NOT RUN**. |
| **F3:** auth flow/account provenance ve yeniden açılış write authority | Son tur native helper'ları flow stamp ile probe/commit'e bağlar, nested Result rejection'ı uygular, credential promotion/logout'u serialized gate içinde tutar; yeniden oluşturulan service native authority alır. `nativeSession.test.ts`, `authority.test.ts` ve ek Rust helper regression kaynakları; Rust testlerinin çalıştığı iddia edilmez. |
| **UI sözleşmesi:** ortak token/panel resize, repo/file tabs, Files/Changes/History, state/footer, AI sidebar, TR/EN, semantik kontroller | Feature component/CSS/layout kaynakları, mode/layout ve rendered workspace testleri incelendi. Focus/keyboard için native semantik kontrol ve focus-visible kuralları kullanılır. Screenshot karşılaştırması/geniş görsel audit kapsam dışı; bunlardan PASS çıkarılmadı. |
| **Mevcut modların regresyonu** | Tam frontend suite. TaskTitleBar'ın önceki 5 test/üretim uyuşmazlığı, testleri silmeden dar completion/reopen kontrolüyle düzeltildi; seçim değişimi ve rejected-write regresyonları eklendi. Docs/Tasks/CRM/Settings veya task authority canlı verisi değiştirilmedi. |
| **Teslim/OAuth kurulumu** | [Adım adım OAuth rehberi](github-mode-oauth-setup.md), bu kabul kaydı ve kalıcı test kanıtları. Gerçek kayıt/giriş/yazma/silme otomatik başlatılmadı. |

F1/F2/F3 contract belgeleri faz teslimindeki tarihsel servis sözleşmeleridir. Özellikle F2'deki erken empty-repo blocker kaydı, F3 ve iki düzeltme turunun yukarıdaki son kanıtıyla kapanmıştır; bu son kayıt kabul durumunun kaynağıdır.

## Bağımsız yönetici komutları ve sonuçları

| Komut / kontrol | Sonuç | Kalıcı kanıt |
| --- | --- | --- |
| `NODE_OPTIONS=--no-experimental-webstorage npm run check` | **exit 0**: typecheck; lint 0 hata/11 uyarı; **103 dosya / 686 test PASS**; Vite build PASS, 2,755 modül | [frontend-check.log](github-mode-evidence/frontend-check.log) |
| `NODE_OPTIONS=--no-experimental-webstorage npm run test -- src/services/github src/services/providers/sessionService.test.ts src/services/codex/sessionService.test.ts` | **exit 0**, 12 dosya / 65 test PASS | [core-regressions.log](github-mode-evidence/core-regressions.log) |
| Manager production probes, son `final-acceptance` tekrar | **exit 0, 16/16 PASS**; gerçek production fonksiyonları + izole transport/storage/IPC ve stock Git interoperability | [production-probes.json](github-mode-evidence/production-probes.json), [log](github-mode-evidence/production-probes.log) |
| `git diff --check` | **exit 0** | Yönetici terminal sonucu |
| Linux checkout `src-tauri`: `cargo fmt --check` | **exit 0**, mevcut kullanıcı araç zinciri kullanıldı; Rust kurulmadı | [cargo-fmt.log](github-mode-evidence/cargo-fmt.log) (başarıda boş stdout) |
| Linux `cargo check --offline` | **exit 101**, compile yapılmadı: crates cache/index'te `aes-gcm` bulunamadı | [cargo-check-offline.log](github-mode-evidence/cargo-check-offline.log) |
| Registration/capability source check | 20 GitHub native command, eksik kayıt yok; capability JSON geçerli, dosya diff'i yok | `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` |

`NODE_OPTIONS` yalnız test komutunun ortamına verildi; global Node/Hermes ayarı veya production güvenlik davranışı değiştirilmedi. Mevcut 11 lint uyarısı ve Vite chunk/dynamic import uyarıları kozmetik/performans olarak ertelendi; test/TS/capability kontrolü zayıflatılmadı.

## İnceleme sonucu ve açık sınırlar

- İzinli kaynak/frontend kabulünde kalan kanıtlanmış blocker **yok**. B1–B8 draft/Git/transport/auth/binary/search/lifecycle/privacy bulguları iki tur içinde düzeltildi; son residual ve TaskTitleBar gate bulguları etkilenen kontrollerle tekrar doğrulandı.
- **Windows `cargo fmt --check`, `cargo check`, `cargo test`, Tauri launch/keyring/OS browser/device login: NOT RUN.** Linux rustfmt yalnız format doğrulamasıdır; başarısız offline cargo check native compilation veya Rust test PASS değildir. Bu teslim Windows native çalışır/production-ready iddiası yapmaz.
- **Gerçek OAuth app kaydı/giriş, canlı GitHub read/write/delete, gerçek AI egress: NOT RUN.** Fixture başarıları gerçek GitHub başarıları değildir.
- **Installer/packaging, deploy, commit/push: yapılmadı ve kapsam dışı.** Çalışma ağacı bilinçli olarak kirli/uncommitted bırakıldı.
- Geniş screenshot/responsive/accessibility audit ve kozmetik uyarı temizliği ertelendi. Zorunlu UI kaynak/işlev kontrolü ile görsel audit birbirine karıştırılmadı.

## Açma ve ilk insan doğrulaması

Kaynaklar ATLAS checkout'undadır; çalışan Windows kopyasına otomatik aktarılmadı. Windows'ta bu değişiklikleri içeren **incelenmiş checkout** kökünde:

```powershell
npm ci
npm run tauri:dev
```

Windows native compile/test sonuçları alındıktan sonra [OAuth rehberinin](github-mode-oauth-setup.md) Settings → Developer settings → OAuth Apps → New OAuth App → Enable Device Flow adımlarını izleyin; **yalnız public Client ID** kullanın, client secret üretmeyin/girmeyin. Önce repo/dosya aç → yerel taslak kaydet → yeniden aç akışını kontrol edin. Gerçek create/commit/delete denemesi ayrı açık kullanıcı yetkisi ve uygun deneme reposu olmadan yapılmamalıdır.
