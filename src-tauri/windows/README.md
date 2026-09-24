# Windows New menu

Both installers register **New > TABS Markdown Document** for `.md` files.
Windows creates an empty file and starts its usual rename interaction. Opening
the file uses the user's default Markdown application; use **Open with > TABS**
if another app is the default.

The registration uses Windows [ShellNew](https://learn.microsoft.com/en-us/windows/win32/shell/context#extending-the-new-submenu)
with `NullFile`, under TABS's own ProgID beneath `.md`. Other extensions and
other applications' templates are not changed. NSIS uses `TABS Text Document`
from `bundle.fileAssociations`; MSI generates `TABS.md`. Keep these names aligned
when changing the app's file associations. The menu text is intentionally English,
matching both installers' supported language; React translations do not apply here.

- `installer-hooks.nsh`: current-user NSIS install/uninstall and shell notification.
- `markdown-shell-new.wxs`: per-machine MSI component, removed by Windows Installer.
- `../../scripts/register-markdown-shell-new.ps1`: enable the entry for an existing
  installation without rebuilding or stopping TABS. Run from the repository root:

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/register-markdown-shell-new.ps1
  ```

Verify on Windows by opening a folder's background context menu, choosing
**New > TABS Markdown Document**, naming the file, and checking that it is an
empty `.md` file. Reopen Explorer if its menu is cached. An installer lifecycle
check should also confirm the entry disappears on uninstall and other applications'
Markdown associations/templates remain. Browser preview cannot test this feature.
