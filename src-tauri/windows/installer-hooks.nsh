; Keep ShellNew under TABS's ProgID so another Markdown app's template survives.
; Tauri's NSIS file association uses the configured association name as its ProgID.
!define TABS_MARKDOWN_SHELL_NEW "Software\Classes\.md\TABS Text Document\ShellNew"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "NullFile" ""
  ; Windows installer copy is intentionally English, like the installer itself.
  WriteRegStr SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "ItemName" "TABS Markdown Document"
  WriteRegStr SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "IconPath" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Remove only our values. Do not delete .md, its default, or other templates.
  DeleteRegValue SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "NullFile"
  DeleteRegValue SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "ItemName"
  DeleteRegValue SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}" "IconPath"
  DeleteRegKey /ifempty SHELL_CONTEXT "${TABS_MARKDOWN_SHELL_NEW}"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\Classes\.md\TABS Text Document"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
