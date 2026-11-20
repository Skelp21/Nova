; Yarvi installer hooks (Tauri NSIS).
; - removes older installs: the app's previous name "Nota" and the .msi flavour of Yarvi
;   (the NSIS Yarvi itself is upgraded in place by Tauri);
; - always creates a desktop shortcut.
; User data (playlists, settings) lives in AppData and is left untouched.

!define YARVI_UNINST_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"

; Scans one registry hive for old versions and uninstalls them silently.
!macro YARVI_REMOVE_OLD ROOT TAG
  StrCpy $R0 0
  yarvi_loop_${TAG}:
    EnumRegKey $R1 ${ROOT} "${YARVI_UNINST_ROOT}" $R0
    StrCmp $R1 "" yarvi_done_${TAG}
    IntOp $R0 $R0 + 1
    ReadRegStr $R2 ${ROOT} "${YARVI_UNINST_ROOT}\$R1" "DisplayName"
    ReadRegStr $R3 ${ROOT} "${YARVI_UNINST_ROOT}\$R1" "UninstallString"
    StrCpy $R4 $R3 7
    StrCmp $R2 "Nota" yarvi_remove_${TAG}
    StrCmp $R2 "Yarvi" 0 yarvi_loop_${TAG}
    StrCmp $R4 "MsiExec" yarvi_remove_${TAG} yarvi_loop_${TAG}

  yarvi_remove_${TAG}:
    ; safety net: never loop forever if an uninstall is cancelled
    IntOp $R6 $R6 + 1
    IntCmp $R6 6 yarvi_done_${TAG} 0 yarvi_done_${TAG}
    DetailPrint "Удаляю старую версию: $R2"
    StrCmp $R4 "MsiExec" 0 yarvi_nsis_${TAG}
      ; MSI: the key name is the product code
      ExecWait 'msiexec.exe /x $R1 /qn /norestart'
      Goto yarvi_restart_${TAG}
    yarvi_nsis_${TAG}:
      ReadRegStr $R5 ${ROOT} "${YARVI_UNINST_ROOT}\$R1" "InstallLocation"
      StrCmp $R5 "" 0 +3
        ExecWait '$R3 /S'
        Goto +2
      ExecWait '$R3 /S _?=$R5'
      Sleep 1500
      ; _?= keeps the uninstaller itself: clean it up
      StrCmp $R5 "" +3
        Delete "$R5\uninstall.exe"
        RMDir "$R5"
      DeleteRegKey ${ROOT} "${YARVI_UNINST_ROOT}\$R1"
  yarvi_restart_${TAG}:
    ; keys shifted after removal: scan again from the start
    StrCpy $R0 0
    Goto yarvi_loop_${TAG}
  yarvi_done_${TAG}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R6 0
  ; the old app may still be running
  nsExec::Exec 'taskkill /F /IM nota.exe'
  Pop $R0
  !insertmacro YARVI_REMOVE_OLD HKCU "hkcu"
  SetRegView 64
  !insertmacro YARVI_REMOVE_OLD HKLM "hklm64"
  SetRegView 32
  !insertmacro YARVI_REMOVE_OLD HKLM "hklm32"
  SetRegView lastused
  Delete "$DESKTOP\Nota.lnk"
  Delete "$SMPROGRAMS\Nota.lnk"
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\Yarvi.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$DESKTOP\Yarvi.lnk"
!macroend
