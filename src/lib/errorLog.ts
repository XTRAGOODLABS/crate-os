// Problem reports: errors in Crate OS are kept in a small log on this Mac.
// Nothing leaves the Mac unless the person opens "Report a problem" and submits the GitHub form.
import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

let sent = 0;

export function logError(message: unknown) {
  if (sent++ > 50) return; // never flood the log from a loop
  const text = message instanceof Error ? `${message.name}: ${message.message}` : String(message);
  void tauriInvoke("report_client_error", { message: text.slice(0, 500) }).catch(() => {});
}

/** Same as Tauri's invoke, but a failed command is also written to the error log. */
export async function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    logError(`${cmd} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export function watchWindowErrors() {
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` (${event.filename.split("/").pop()}:${event.lineno})` : "";
    logError(`${event.message || "error"}${where}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logError(`Unhandled: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}
