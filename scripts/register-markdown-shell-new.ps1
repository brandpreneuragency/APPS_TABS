# Enable Explorer > New > TABS Markdown Document for an existing TABS install.
# Future NSIS/MSI installations register this automatically.
# This does not change the default Markdown app or Windows UserChoice.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$classes = [Microsoft.Win32.Registry]::ClassesRoot
$progId = @('TABS Text Document', 'TABS.md') | Where-Object {
    $key = $classes.OpenSubKey("$_\shell\open\command")
    if ($null -eq $key) { return $false }
    try { return -not [string]::IsNullOrWhiteSpace([string]$key.GetValue('')) }
    finally { $key.Dispose() }
} | Select-Object -First 1
if (-not $progId) { throw 'Install TABS before registering its New menu entry.' }

$iconKey = $classes.OpenSubKey("$progId\DefaultIcon")
if ($null -eq $iconKey) { throw 'The installed TABS file association has no icon.' }
try { $icon = [string]$iconKey.GetValue('') }
finally { $iconKey.Dispose() }
if ([string]::IsNullOrWhiteSpace($icon)) { throw 'The installed TABS icon path is empty.' }

$keyPath = "Software\Classes\.md\$progId\ShellNew"
$existing = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($keyPath)
if ($null -ne $existing) {
    try {
        if ($existing.GetValue('ItemName') -ne 'TABS Markdown Document') {
            throw "An existing template occupies $keyPath; no changes were made."
        }
    } finally { $existing.Dispose() }
}

$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($keyPath)
try {
    $key.SetValue('NullFile', '', [Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('ItemName', 'TABS Markdown Document', [Microsoft.Win32.RegistryValueKind]::String)
    $key.SetValue('IconPath', $icon, [Microsoft.Win32.RegistryValueKind]::String)
} finally { $key.Dispose() }

if (-not ('Tabs.ShellNewNotification' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
namespace Tabs {
    public static class ShellNewNotification {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    }
}
'@
}
[Tabs.ShellNewNotification]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "Registered Explorer > New > TABS Markdown Document (.md) for this user."
Write-Output "Registry: HKEY_CURRENT_USER\$keyPath"
