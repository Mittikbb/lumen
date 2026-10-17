// Терминал: "-ipconfig" in search, Enter, and the command runs in a new
// window of the default terminal, which stays open with its output.
const SHELLS = { powershell: "PowerShell", pwsh: "PowerShell 7", cmd: "cmd" };
const isMac = navigator.userAgent.includes("Mac");

lumen.search.provide((query) => {
  const command = query.trim().slice(1).trim();
  if (!command) {
    return [{ id: "hint", title: "Напиши команду после «-»", hint: "Например: -ipconfig или -ping 8.8.8.8", icon: ">_" }];
  }
  const shell = lumen.settings.shell;
  return [
    {
      id: "run",
      title: command,
      hint: `Enter — выполнить в ${isMac ? "Терминале" : SHELLS[shell] ?? "PowerShell"}`,
      icon: ">_",
      terminal: command,
      shell,
    },
  ];
});
