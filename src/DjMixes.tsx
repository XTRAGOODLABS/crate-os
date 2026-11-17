import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type DjMixesStatus = {
  running: boolean;
  lan_mode: boolean;
  local_url: string | null;
  lan_url: string | null;
};

type DjMixesStartResponse = {
  message: string;
  status: DjMixesStatus;
  migrated_files: string[];
};

export default function DjMixes() {
  const [status, setStatus] = useState<DjMixesStatus | null>(null);
  const [message, setMessage] = useState("Checking DJ Mixes…");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        let current = await invoke<DjMixesStatus>("dj_mixes_status");
        let nextMessage = current.lan_mode
          ? "Protected LAN access is active."
          : "Connected to GOOD MIXX locally.";
        if (!current.running) {
          const response = await invoke<DjMixesStartResponse>("start_dj_mixes", { lanMode: false });
          current = response.status;
          const migrated = response.migrated_files.length
            ? ` Imported ${response.migrated_files.join(", ")} from the previous DJ Mixes installation.`
            : "";
          nextMessage = response.message + migrated;
        }
        if (!cancelled) {
          setStatus(current);
          setMessage(nextMessage);
        }
      } catch (error) {
        if (!cancelled) setMessage(String(error));
      }
    };
    void start();
    return () => { cancelled = true; };
  }, [retry]);

  async function switchMode(lanMode: boolean) {
    setStatus(null);
    setMessage(lanMode ? "Starting protected LAN access…" : "Switching to Mac-only access…");
    try {
      await invoke("stop_dj_mixes");
      const response = await invoke<DjMixesStartResponse>("start_dj_mixes", { lanMode });
      setStatus(response.status);
      setMessage(response.message);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function importLegacyData() {
    try {
      const result = await invoke<{ imported: string[]; skipped: string[]; source_found: boolean }>(
        "import_legacy_dj_mixes_data",
      );
      if (!result.source_found) {
        setMessage("No previous ~/Portal-Stems-FX data folder was found.");
      } else if (result.imported.length) {
        setMessage(`Imported ${result.imported.join(", ")}. Reconnect to reload the data.`);
      } else {
        setMessage("Existing Crate OS DJ Mixes data was kept; nothing was overwritten.");
      }
    } catch (error) {
      setMessage(String(error));
    }
  }

  return <section className="dj-mixes-embedded">
    <div className="dj-mixes-toolbar">
      <div><strong>GOOD MIXX — Mix Memory</strong><span>{message}</span></div>
      <div className="dj-mixes-toolbar-actions">
        <button type="button" onClick={() => { setStatus(null); setRetry(n => n + 1); }}>Reconnect</button>
        <button type="button" onClick={() => void switchMode(false)}>Mac only</button>
        <button type="button" onClick={() => void switchMode(true)}>Enable iPad / Portal</button>
        <button type="button" onClick={() => void importLegacyData()}>Import previous data</button>
        <button type="button" onClick={() => void invoke("open_traktor_link_installer").catch(e => setMessage(String(e)))}>Add Traktor link</button>
        <button type="button" onClick={() => void invoke("open_traktor_link_remover").catch(e => setMessage(String(e)))}>Remove Traktor link</button>
        <button type="button" onClick={() => void invoke("open_dj_mixes_browser").catch(e => setMessage(String(e)))}>Open in browser</button>
      </div>
    </div>
    {status?.running && status.local_url ? <>
      {status.lan_url && <p className="dj-mixes-lan-url">iPad / Portal: <code>{status.lan_url}</code></p>}
      <iframe title="Original DJ Mixes live dashboard" src={status.local_url} className="dj-mixes-frame" />
    </> :
      <div className="dj-mixes-loading">
        <p>{message}</p>
        <p>The updated LIVE, REVIEW A SET, MY MIXES, WHAT&apos;S NEXT, and BPM/key recommendations will appear here.</p>
        <p>GOOD MIXX follows djay or Traktor. For screen-based djay key detection, grant Accessibility to Crate OS in macOS settings.</p>
      </div>}
  </section>;
}
