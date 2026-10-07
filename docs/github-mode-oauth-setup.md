# TABS GitHub Mode — OAuth kurulum ve ilk kullanım

Bu yönerge, TABS'in yerel Windows masaüstü uygulamasında GitHub.com kişisel hesap bağlantısını kullanıcı tarafından kurmak içindir. OAuth uygulama kaydı, gerçek hesap girişi veya GitHub üzerinde oluşturma/silme bu çalışma sırasında yapılmadı.

## 1. GitHub OAuth uygulamasını kaydet

GitHub hesabında profil fotoğrafı → **Settings** → sol menü **Developer settings** → **OAuth Apps** → **New OAuth App** yolunu açın. İlk uygulamanızsa düğme **Register a new application** olarak görünebilir.

Formda şu değerleri kullanın:

- **Application name:** `TABS Desktop` (veya kullanıcıların tanıyacağı bir TABS adı).
- **Homepage URL:** `https://github.com/brandpreneuragency/APPS_TABS` — TABS için ayrı bir kamuya açık ürün sitesi belirlenmediyse kaynak proje sayfası.
- **Application description:** isteğe bağlı; örneğin `Local TABS desktop client for GitHub repositories`.
- **Authorization callback URL:** `http://127.0.0.1/callback`. TABS web callback akışı kullanmaz; bu alan GitHub kayıt formu içindir ve Device Flow sırasında çağrılmaz. Loopback URI kullanın; `localhost` kullanmayın.
- **Enable Device Flow:** mutlaka işaretleyin.

Uygulamayı kaydedin. **Client ID** değerini alın; **Client secret üretmeyin, kopyalamayın veya TABS'e girmeyin.** Bu masaüstü akışı public client ID ile Device Flow kullanır ve client secret gerektirmez. Secret alanını doldurmanızı isteyen bir yönerge veya ekran görürseniz durun.

## 2. TABS masaüstünde Client ID'yi kaydet ve bağlan

1. Windows'ta TABS masaüstü uygulamasını açın ve ana gezinmeden **GitHub** modunu seçin.
2. Kurulum ekranındaki **GitHub OAuth App Client ID** alanına az önceki public **Client ID** değerini yapıştırın; **Save Client ID**'ye basın.
3. **Connect GitHub**'ı seçin. TABS, GitHub'ın Device Flow ekran kodunu gösterir.
4. TABS içindeki **Open GitHub device sign-in** düğmesini seçin. Bu düğme Tauri native komutu `github_open_device_login` ile yalnız `https://github.com/login/device` adresini işletim sisteminin tarayıcısında açar; uygulamanın içindeki bir webview bağlantısı veya genel URL açıcı değildir.
5. GitHub sayfasında TABS'in gösterdiği tek kullanımlık kodu girip GitHub'ın izin ekranını dikkatle inceleyin. Onayladıktan sonra TABS'e dönüp **I entered the code** düğmesine basın. Kod 15 dakika içinde kullanılmazsa TABS'te yeni bir giriş başlatın; eski kodu tekrar kullanmayın.

Bağlantı kurulmazsa Client ID'yi ve OAuth uygulamasında **Enable Device Flow** ayarını kontrol edin. Tarayıcı önizlemesinde native komut kullanılamıyorsa canlı TABS bağlantısı varmış gibi değerlendirmeyin; Windows Tauri uygulamasını kullanın.

## 3. İzinlerin kapsamı

- İlk bağlantıda TABS yalnız `repo` scope'unu ister. GitHub bunu public ve private depolar üzerinde tam okuma/yazma erişimi ve bazı ilişkili kaynaklara erişim olarak tanımlar. Scope GitHub'da organizasyon kaynaklarına da erişim sağlayabilir; TABS kullanıcı arayüzü ise organizasyon repolarını desteklenen hedef olarak kabul etmez. Uygulama sınırının GitHub'ın verdiği OAuth scope'unu daraltmadığını bilin.
- `public_repo`, private repo desteğinin yerini tutmaz; izin ekranındaki kapsamı beklenmedik görürseniz onaylamayın.
- `delete_repo` ilk bağlantıda istenmez. Kalıcı silme akışında, kullanıcı özellikle isterse TABS ayrı Device Flow yükseltmesiyle tam `repo delete_repo` scope'unu ister. Bu scope, GitHub'da hesabınızın yönetebildiği depoları silebilir; yalnız listeden kapatma bu izni kullanmaz ve uzak depoyu silmez.
- OAuth uygulaması iznini daha sonra GitHub **Settings → Applications → Authorized OAuth Apps** bölümünden inceleyip iptal edebilirsiniz. İzin iptali TABS'in yeni uzak isteklerini durdurur; GitHub'a önceden gönderilmiş içerik geri alınamaz.

## 4. Geliştirici çalıştırma komutları

Windows PowerShell'de, TABS checkout'unun kök dizininde çalıştırın:

```powershell
npm ci
npm run tauri:dev
```

`npm run tauri:dev`, uygulamayı yerel Tauri masaüstü geliştirme runtime'ında başlatır; Windows Rust/Tauri araç zincirinin önceden kurulu olması gerekir. Bu proje için geçerli paket komutu `npm run tauri:build`'dir; bu yönergede paketleme veya imzalama çalıştırıldığı iddia edilmez.

`npm run dev` yalnız Vite tarayıcı önizlemesidir; desteklenen üretim runtime'ı değildir ve TABS'in native GitHub login/boundary doğrulaması yerine geçmez. Canlı hesap, token veya repository mutation denemesi bu rehberin parçası değildir.

## 5. Kaynak sözleşmeleri ve doğrulama sınırı

- TABS ayar anahtarı `githubOauthClientId`; ekrandaki **GitHub OAuth App Client ID** alanı `configureClientId` store eylemine bağlanır. Device Flow client secret kullanmaz.
- Device sign-in ekranındaki açma düğmesi `openDeviceLogin` store eylemini çağırır; native taraftaki `github_open_device_login` yalnız sabit GitHub device URL'sini açar.
- İlk bağlantı `repo` scope'u ister. Kalıcı silme yükseltmesi yalnız açık silme akışında `repo delete_repo` ister; son silme ayrıca doğrulanmış tam hedef ve ayrı onay gerektirir.
- Kaynak sözleşmeleri: [`github-mode-f3-contract.md`](github-mode-f3-contract.md), [`github-mode-correction-contract.md`](github-mode-correction-contract.md).
- Resmî GitHub belgeleri: [OAuth app oluşturma](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [OAuth uygulamasını yetkilendirme ve Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [OAuth scope'ları](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

## 6. Kabul kanıtı — gözlenen çalışma ağacı durumu

| Kontrol | Gerçek kanıt | Sınır / durum |
| --- | --- | --- |
| Kaynak baseline | Checkout `main`, HEAD `fdf1af2f8e5c66e60136bc34b18be4bef33a289f`; çalışma ağacı kirli. `src/components/github/`, `src/services/github/`, `src/stores/githubStore.ts` ve GitHub Mode belgeleri untracked durumdaydı. | Commit, push veya yayın yapılmadı. |
| GitHub ve Türkçe tarih UI testleri | `NODE_OPTIONS=--no-experimental-webstorage npm run test -- src/components/github/GithubWorkspace.test.tsx src/components/taskManager/TaskListPanel.test.tsx` — 2 test dosyası geçti, 21 test geçti. TaskListPanel testi İngilizce i18n fixture'ını, sabit fake time'ı ve `finally` içinde gerçek timer restorasyonunu kullanır; `formatTurkishClock` çıktısı üretim davranışı olarak Türkçe doğrulanır. | İzole fixture/fake-indexeddb; canlı GitHub değil. Node Web Storage çakışması için seçenek yalnız bu test sürecine verildi; production locale değiştirilmedi. |
| Repo oluşturma/silme ve Device Flow UI | Yukarıdaki GitHub workspace test dosyasındaki rendered testler; repo oluşturma, exact-target delete onayı/scope yükseltme ve native device URL eylemi fixture/test-double ile çalıştırıldı. | Gerçek OAuth kaydı/girişi veya uzak create/delete yapılmadı. |
| TaskTitleBar kapsam dışı durum tespiti (düzeltme öncesi tarihsel kayıt) | Üç hedef dosya komutu (`NODE_OPTIONS=--no-experimental-webstorage npm run test -- src/components/github/GithubWorkspace.test.tsx src/components/header/TaskTitleBar.test.tsx src/components/taskManager/TaskListPanel.test.tsx`) — 2/3 test dosyası geçti; 28 testten 23 geçti, 5 başarısız. TaskTitleBar testleri kaynakta bulunmayan `Mark as completed` / `Mark as incomplete` düğmelerini bekliyordu. Metadata child export mock'u mevcut bileşen isimleriyle eşleştirildi. | Bu, üretim düzeltmesinden önceki uyuşmazlıktı. Assertion silinmedi veya atlanmadı; sonraki dar TaskTitleBar üretim düzeltmesi bu ürün davranışını ekledi. |
| Tam frontend gate (düzeltme öncesi tarihsel kayıt) | `NODE_OPTIONS=--no-experimental-webstorage npm run check` — exit 1. Typecheck geçti; ESLint 0 hata ve 11 uyarıyla geçti; Vitest 101 dosyada 100 geçti/1 başarısız, 682 testte 677 geçti/5 başarısız. Beş başarısızlığın tamamı yukarıdaki TaskTitleBar testleriydi. | Bu düzeltme öncesi çalışmada test aşamasında duruldu; `npm run check` içindeki build aşaması çalışmadı. Gerçek çıktı: `/home/admin/.hermes/cache/scratch/tabs-github-phase3-light-check-Chny2k.log`. |
| Bağımsız frontend build (düzeltme öncesi tarihsel kayıt) | `npm run build` — exit 0; `tsc -b` ve Vite build tamamlandı, 2,755 modül dönüştürüldü. Vite büyük-chunk ve ineffective-dynamic-import uyarıları verdi. | Bu eski bağımsız build, tam gate'in yerine geçmiyordu ve Windows/Tauri build değildi. Çıktı: `/home/admin/.hermes/cache/scratch/tabs-github-phase3-light-build-3mzhrj.log`. |
| Windows native doğrulaması | Bu oturumda Windows `cargo fmt --check`, `cargo check`, Tauri runtime veya installer çalıştırılmadı. | **NOT RUN** — ATLAS Linux ortamı; TABS hedef runtime'ı Windows Tauri. |
| Review | Yönetici tek birleşik incelemeyi ve iki blocker düzeltme turunun orantılı tekrar kontrolünü tamamladı. Bağımsız son `npm run check` exit 0: 103 dosya/686 test. | **Kaynak/frontend kabulü tamamlandı; native Windows ve canlı GitHub NOT RUN.** Son durum ve kalıcı kanıtlar: [`github-mode-acceptance.md`](github-mode-acceptance.md). |
| TaskTitleBar ve entegrasyon odaklı testler (düzeltme sonrası) | `NODE_OPTIONS=--no-experimental-webstorage npm run test -- src/components/header/TaskTitleBar.test.tsx src/components/taskManager/TaskListPanel.test.tsx src/components/github/GithubWorkspace.test.tsx` — exit 0; 3 test dosyası ve 30 test geçti. Yeni dar regresyonlar bekleyen işlem sırasında seçim değişimini ve reddedilen yazmada yerel hata bildirimi/yeniden etkinleşmeyi kapsar. | Fixture ve store mock'ları; canlı GitHub/OAuth değildir. Çıktı: `/home/admin/.hermes/cache/scratch/tabs-github-light-correction2-focused-after.log`. |
| Zorunlu frontend gate (düzeltme sonrası) | `NODE_OPTIONS=--no-experimental-webstorage npm run check` — exit 0. Typecheck geçti; ESLint 0 hata, 11 uyarı; Vitest 103/103 dosya ve 686/686 test geçti; build başarılı, 2,755 modül dönüştürüldü. | Linux kaynak/frontend doğrulamasıdır. Lint ve Vite'ın mevcut uyarıları blocker değildi. Windows/Tauri, gerçek OAuth/GitHub ve yönetici incelemesi bu gate tarafından doğrulanmadı. Gerçek çıktı: `/home/admin/.hermes/cache/scratch/tabs-github-light-correction2-full-check.log`. |

Bu tablo yukarıdaki düzeltme öncesi ve sonrası gerçek komut çıktılarını ayrı ayrı kaydeder. Düzeltme, test assertion'larını değiştirmek değil; `TaskTitleBar`'a yalnız seçili görevin durumunu `pending`/`in_progress` → `completed` ve `completed` → `in_progress` güncelleyen küçük bir üretim eylemi eklemektir. Var olan başlık düzenleme, müşteri/proje/tarih kontrolleri korunmuştur; alt görev daraltma/açma davranışı eklenmemiştir. Fixture başarıları gerçek OAuth/GitHub/Tauri çalışması veya üretime hazır olma kanıtı değildir. Windows `npm ci` + `npm run tauri:dev` ile yerel Device Flow ve Client ID kurulumu yönergede anlatılır; bu oturumda çalıştırılmadı. Client secret kullanılmaz. Windows/Cargo/Tauri, canlı OAuth/GitHub ve installer/deploy **NOT RUN**. Yönetici kaynak/frontend birleşik kabulü ve bağımsız son gate tamamlandı; Linux rustfmt PASS ve offline cargo compile engeli dahil son sonuçlar [`github-mode-acceptance.md`](github-mode-acceptance.md) belgesindedir. Bu kabul native Windows veya production GitHub çalışmasının doğrulandığı anlamına gelmez.
