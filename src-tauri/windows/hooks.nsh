; Hooks for Tauri's NSIS installer (bundle.windows.nsis.installerHooks).

; "Start with Windows as administrator" leaves a Task Scheduler task that
; would outlive Lumen. Removing it needs admin rights, so Windows asks once;
; only if the task is there, and not on updates, which keep it.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::Exec 'schtasks.exe /Query /TN "Lumen"'
    Pop $0
    ${If} $0 = 0
      ExecShellWait "runas" "schtasks.exe" '/Delete /TN "Lumen" /F' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
