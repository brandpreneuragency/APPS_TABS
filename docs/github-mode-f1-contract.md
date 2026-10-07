# GitHub mode — Faz 1 servis sözleşmesi

Bu not yalnız Strong servis/state/persistence sınırıdır. UI, atomik commit, çakışma çözümü ve repo oluşturma/silme bu fazda yoktur. Planın tamamı bitmiş değildir.

## OAuth kararı

5 Ekim 2026 tarihli docs.github.com authorizing-oauth-apps sayfasına göre:

- Device flow client secret istemez. Üretim yolu budur: POST https://github.com/login/device/code, kullanıcı https://github.com/login/device adresini açar, sonra POST https://github.com/login/oauth/access_token grant_type=urn:ietf:params:oauth:grant-type:device_code.
- Web application code exchange client_secret ister. PKCE bunu kaldırmaz. Bu yüzden loopback/code exchange yok; secret kabul edilmez ve bundle'a gömülmez.
- Device flow ile üretilen refresh token yenilemesi client_secret istemez. offline_access istenmez. Uygulama expiring token döndürürse refresh token yalnız native secure storage'a yazılır.
- İstenen scope yalnız `repo`. `delete_repo` istenmez. GitHub OAuth'ta private okuma için daha dar scope yoktur; silme yetkisi sonra ayrıca yükseltilir.

Client ID yokken bağlantı `needs_setup`. Tauri yokken `native_unavailable`. Fixture transport üretim koduna bağlı değildir.

## Luna'nın kullanacağı yüzey

Store: `src/stores/githubStore.ts`

- `useGithubStore` masaüstü portlarını kullanır. Test ve izole açılış için `createGithubStore(service)`.
- `configureClientId`, `beginDeviceBrowserSignIn`, `finishDeviceBrowserSignIn`, `cancelSignIn`, `signOut`
- `refreshRepos`, `selectRepo(repoId, ref)`, `selectBranch`, `browse(path)`, `openPath(path)`
- `saveOpenedDraft`, `saveDraft`, `setPanel`, `setOpenPaths`, `restore`, `cancelActive`, `deleteDrafts`
- `signOut` taslak silmez. `deleteDrafts` ancak `{ confirm: true, accountId, repoId?, ref?, path? }` ile siler.

Servis tipleri: `src/services/github/index.ts`

Bağlantı durumları: `needs_setup`, `native_unavailable`, `signed_out`, `authorizing`, `connected`, `auth_expired`. Hiçbir durumda token alanı yoktur. `authorizing.challenge` yalnız `userCode`, sabit `browserUrl` (`https://github.com/login/device`), `expiresAt`, `intervalSeconds` verir. Tarayıcıyı açmak UI işidir; shell izni eklenmedi.

Kimlik: GitHub sayısal hesap ID + repo ID + branch/ref + path. Repo adı kimliğe girmez.

## Persistence

Dexie `ZenEditorDB` sürüm 20. Yeni tablolar: `githubAccounts`, `githubDrafts`, `githubWorkspaces`, `githubPrivateCache`. Eski tablolara dokunulmaz. Token IndexedDB'ye yazılmaz.

Private cache AES-GCM ile kapanır. Anahtar yalnız secure store hesabı `github.cache-key` içindedir. Çıkışta access, refresh ve cache key silinir; ciphertext kalabilir ama servis okumaz. Taslaklar kalır.

Boş dizin: Git boş klasör saklamaz. `GITHUB_EMPTY_DIRECTORY_NOTE` bunu söyler. Symlink, submodule ve LFS pointer takip edilmez. 1 MB üstü dosya metne çevrilmez.

## Native sınır

Komutlar: `github_credential_status`, `github_credential_put`, `github_credential_delete`, `github_transport_request`. Capability dosyası genişletilmedi. `github_transport_request` host/redirect/token kurallarını doğrular ve bu build'de `native_http_not_linked` döner. Token webview'a okunmaz.

## Doğrulama sınırı

Fixture + izole Dexie testleri gerçek GitHub başarısı değildir. Canlı OAuth, canlı yazma ve Windows `cargo`/`rustc` kontrolleri NOT RUN.
