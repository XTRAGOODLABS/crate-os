import DjMixes from "./DjMixes";
import PlaylistBuilder from "./PlaylistBuilder";
import { invoke } from "./lib/errorLog";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { productByline, productName } from "./lib/brand";
import { checkFeature } from "./lib/paywall/featureGate";
import type { ToolkitTier } from "./lib/entitlements";

type ScanSummary = {
  scan_id: string;
  root: string;
  track_count: number;
  total_bytes: number;
  known_runtime_seconds: number;
  unknown_runtime_count: number;
};

type ScanProgress = {
  phase: "discovering" | "scanning" | "saved";
  current: number;
  total: number;
  path?: string;
};

type TrackRow = {
  path: string;
  relative_folder: string;
  filename: string;
  extension: string;
  file_size_bytes: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  duration_seconds: number | null;
  proposed_bucket: string;
  live365_readiness: string;
  scan_status: string;
  metadata_dirty: boolean;
  tag_write_status: string;
};

type EditableTrackField =
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year"
  | "proposed_bucket"
  | "live365_readiness";

type BulkForm = {
  artist: string;
  album: string;
  genre: string;
  year: string;
  proposed_bucket: string;
  live365_readiness: string;
};

type FolderRollup = {
  folder: string;
  trackCount: number;
  totalBytes: number;
  runtimeSeconds: number;
  unknownRuntimeCount: number;
  missingMetadataCount: number;
  newCount: number;
  changedCount: number;
  missingCount: number;
};

const emptyBulkForm: BulkForm = {
  artist: "",
  album: "",
  genre: "",
  year: "",
  proposed_bucket: "",
  live365_readiness: "",
};

const bucketOptions = ["day_safe", "day_safe_review", "club_late_night", "longform_radio"];
const readinessOptions = [
  "metadata_review_before_upload",
  "ready_for_upload",
  "needs_rights_review",
  "do_not_upload",
];
const statusOptions = ["all", "new", "changed", "unchanged", "missing", "scanned"];


export default function App() {
  const [view, setView] = useState<"lib" | "builder" | "mixes">("lib");
  const [folder, setFolder] = useState("");
  const [limit, setLimit] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [bulkForm, setBulkForm] = useState<BulkForm>(emptyBulkForm);
  const [metadataStatus, setMetadataStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [isWritingTags, setIsWritingTags] = useState(false);
  const [isRestoringTags, setIsRestoringTags] = useState(false);
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const currentTier: ToolkitTier = "pro";
  const advancedExportGate = checkFeature(currentTier, "live365.upload.apply");

  const refreshLatest = useCallback(async () => {
    const latest = await invoke<{ summary: ScanSummary | null; tracks: TrackRow[] }>(
      "latest_scan",
    );
    setSummary(latest.summary);
    setTracks(latest.tracks);
    setSelectedPaths(new Set());
  }, []);

  useEffect(() => {
    void refreshLatest();
    const unlisten = listen<ScanProgress>("scan-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [refreshLatest]);

  async function chooseFolder() {
    const selected = await invoke<string | null>("choose_folder");
    if (selected) setFolder(selected);
  }

  async function scan() {
    if (!folder) return;
    setIsScanning(true);
    try {
      const result = await invoke<ScanSummary>("scan_library", {
        root: folder,
        limit: limit ? Number(limit) : null,
      });
      setSummary(result);
      await refreshLatest();
    } finally {
      setIsScanning(false);
    }
  }

  function updateTrackField(path: string, field: EditableTrackField, value: string) {
    setTracks((currentTracks) =>
      currentTracks.map((track) => (track.path === path ? { ...track, [field]: value } : track)),
    );
  }

  async function saveTrack(track: TrackRow) {
    if (!summary) return;
    await invoke("update_track_metadata", {
      update: {
        scan_id: summary.scan_id,
        path: track.path,
        title: track.title,
        artist: track.artist,
        album: track.album,
        genre: track.genre,
        year: track.year,
        proposed_bucket: track.proposed_bucket,
        live365_readiness: track.live365_readiness,
      },
    });
    setMetadataStatus(`Saved ${track.title || track.filename}`);
    setTracks((currentTracks) =>
      currentTracks.map((currentTrack) =>
        currentTrack.path === track.path
          ? { ...currentTrack, metadata_dirty: true, tag_write_status: "pending" }
          : currentTrack,
      ),
    );
  }

  function toggleTrack(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function toggleVisibleTracks() {
    setSelectedPaths((current) => {
      const visiblePaths = filteredTracks.map((track) => track.path);
      const allVisibleSelected = visiblePaths.every((path) => current.has(path));
      const next = new Set(current);
      for (const path of visiblePaths) {
        if (allVisibleSelected) {
          next.delete(path);
        } else {
          next.add(path);
        }
      }
      return next;
    });
  }

  async function applyBulkEdit() {
    if (!summary || selectedPaths.size === 0) return;
    const update = Object.fromEntries(
      Object.entries(bulkForm).filter(([, value]) => value.trim().length > 0),
    );
    if (Object.keys(update).length === 0) return;

    const paths = Array.from(selectedPaths);
    await invoke("bulk_update_tracks", {
      update: {
        scan_id: summary.scan_id,
        paths,
        ...update,
      },
    });
    setTracks((currentTracks) =>
      currentTracks.map((track) =>
        selectedPaths.has(track.path)
          ? { ...track, ...update, metadata_dirty: true, tag_write_status: "pending" }
          : track,
      ),
    );
    setBulkForm(emptyBulkForm);
    setMetadataStatus(`Updated ${paths.length.toLocaleString()} selected tracks`);
  }

  async function exportScan(format: "csv" | "djprep" | "m3u" | "json" | "live365") {
    setIsFileMenuOpen(false);
    setExportStatus("");
    try {
      const selected = Array.from(selectedPaths);
      const result = await invoke<{ path: string }>("export_latest_scan", {
        args: {
          format,
          paths: selected.length > 0 ? selected : null,
          folder: selected.length > 0 ? null : folderFilter,
          status: statusFilter,
        },
      });
      setExportStatus(`Exported ${result.path}`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function selectFolder(folderName: string) {
    setFolderFilter(folderName);
    setSelectedPaths(new Set());
  }

  async function openExportsFolder() {
    setIsFileMenuOpen(false);
    try {
      await invoke("open_exports_folder");
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function writeSelectedTags() {
    if (!summary || selectedPaths.size === 0) return;
    setIsWritingTags(true);
    setMetadataStatus("");
    try {
      const result = await invoke<{
        written_count: number;
        failed_count: number;
        backup_path: string;
      }>("write_tags_to_files", {
        args: {
          scan_id: summary.scan_id,
          paths: Array.from(selectedPaths),
        },
      });
      setMetadataStatus(
        `Wrote ${result.written_count.toLocaleString()} files, ${result.failed_count.toLocaleString()} failed. Backup: ${result.backup_path}`,
      );
      await refreshLatest();
    } catch (error) {
      setMetadataStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsWritingTags(false);
    }
  }

  async function restoreLatestTagBackup() {
    if (!summary) return;
    setIsRestoringTags(true);
    setMetadataStatus("");
    try {
      const result = await invoke<{
        restored_count: number;
        failed_count: number;
        backup_path: string;
      }>("restore_latest_tag_backup", {
        args: {
          scan_id: summary.scan_id,
        },
      });
      setMetadataStatus(
        `Restored ${result.restored_count.toLocaleString()} files, ${result.failed_count.toLocaleString()} failed. Backup: ${result.backup_path}`,
      );
      await refreshLatest();
    } catch (error) {
      setMetadataStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestoringTags(false);
    }
  }

  const folderRollups = (() => {
    const rollups = new Map<string, FolderRollup>();
    for (const track of tracks) {
      const folderName = track.relative_folder || "(root)";
      const rollup =
        rollups.get(folderName) ??
        {
          folder: folderName,
          trackCount: 0,
          totalBytes: 0,
          runtimeSeconds: 0,
          unknownRuntimeCount: 0,
          missingMetadataCount: 0,
          newCount: 0,
          changedCount: 0,
          missingCount: 0,
        };
      rollup.trackCount += 1;
      if (track.scan_status !== "missing") {
        rollup.totalBytes += track.file_size_bytes;
      }
      if (track.duration_seconds === null) {
        rollup.unknownRuntimeCount += 1;
      } else if (track.scan_status !== "missing") {
        rollup.runtimeSeconds += track.duration_seconds;
      }
      if (!track.artist || !track.title || !track.genre) {
        rollup.missingMetadataCount += 1;
      }
      if (track.scan_status === "new") rollup.newCount += 1;
      if (track.scan_status === "changed") rollup.changedCount += 1;
      if (track.scan_status === "missing") rollup.missingCount += 1;
      rollups.set(folderName, rollup);
    }
    return Array.from(rollups.values()).sort((a, b) => a.folder.localeCompare(b.folder));
  })();

  const filteredTracks = (() => {
    const query = search.trim().toLowerCase();
    return tracks
      .filter((track) => folderFilter === "all" || track.relative_folder === folderFilter)
      .filter((track) => statusFilter === "all" || track.scan_status === statusFilter)
      .filter((track) => {
        if (!query) return true;
        return [track.artist, track.title, track.album, track.genre, track.filename, track.path]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 500);
  })();


  return (
    <main>
      <header>
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element -- Vite/Tauri app, not a Next.js route. */}
          <img src="/crate-os-logo-mark.png" alt="" className="brand-logo" />
          <div>
            <h1>{productName}™</h1>
            <p className="product-byline">{productByline}</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button
            type="button"
            className={view === "lib" ? "tab active" : "tab"}
            aria-pressed={view === "lib"}
            onClick={() => setView("lib")}
          >
            Library
          </button>
          <button type="button" className={view === "builder" ? "tab active" : "tab"}
            aria-pressed={view === "builder"} onClick={() => setView("builder")}>Crate Builder</button>
          <button type="button" className={view === "mixes" ? "tab active" : "tab"}
            aria-pressed={view === "mixes"} onClick={() => setView("mixes")}>GOOD MIXX™</button>
          <button type="button" className="tab support" title="Support XTRA GOOD LABS"
            onClick={() => void invoke("open_support_page")}>☕ Buy me a coffee</button>
          <button type="button" className="tab report"
            title="Opens a bug report on GitHub with the details filled in. Nothing is sent until you submit it."
            onClick={() => void invoke("open_report_problem")}>Report a problem</button>
        </nav>
      </header>

      {view === "builder" ? <PlaylistBuilder tracks={tracks} /> : null}
      {view === "mixes" ? <DjMixes /> : null}
      {view === "lib" ? (
        <>
          <nav className="app-menu" aria-label="File menu">
            <div className="menu-group">
              <button
                type="button"
                className="menu-trigger"
                aria-haspopup="menu"
                aria-expanded={isFileMenuOpen}
                onClick={() => setIsFileMenuOpen((open) => !open)}
              >
                Export
              </button>
              {isFileMenuOpen ? (
                <div className="menu-popover" role="menu">
                  <button type="button" role="menuitem" disabled={!summary} onClick={() => exportScan("csv")}>
                    Export CSV
                  </button>
                  <button type="button" role="menuitem" disabled={!summary} onClick={() => exportScan("djprep")}>
                    DJ prep CSV
                  </button>
                  <button type="button" role="menuitem" disabled={!summary} onClick={() => exportScan("m3u")}>
                    M3U8 playlist
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!summary || !advancedExportGate.allowed}
                    onClick={() => exportScan("json")}
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!summary || !advancedExportGate.allowed}
                    onClick={() => exportScan("live365")}
                  >
                    Live365 CSV
                  </button>
                  <button type="button" role="menuitem" onClick={openExportsFolder}>
                    Open exports folder
                  </button>
                </div>
              ) : null}
            </div>
            {exportStatus ? <p className="status menu-status">{exportStatus}</p> : null}
          </nav>

          <section className="panel scan-panel">
            <div className="label">Library scan</div>
            <div className="scan-form">
              <label>
                <span className="label">Folder</span>
                <input value={folder} onChange={(event) => setFolder(event.target.value)} />
              </label>
              <label>
                <span className="label">Limit</span>
                <input
                  inputMode="numeric"
                  placeholder="optional"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                />
              </label>
              <button type="button" onClick={chooseFolder}>
                Choose folder
              </button>
              <button type="button" disabled={!folder || isScanning} onClick={scan}>
                {isScanning ? "Scanning..." : "Scan library"}
              </button>
            </div>
            <p className="status">
              {progress
                ? `${progress.phase}: ${progress.current}/${progress.total}${progress.path ? ` - ${progress.path}` : ""}`
                : "Native folder picker, SQLite persistence, and scan progress are wired through Tauri."}
            </p>
          </section>

          {summary ? (
            <section className="stats">
              <Stat label="Tracks" value={summary.track_count.toLocaleString()} />
              <Stat label="Size" value={formatBytes(summary.total_bytes)} />
              <Stat label="Runtime" value={formatRuntime(summary.known_runtime_seconds)} />
              <Stat label="Unknown" value={summary.unknown_runtime_count.toLocaleString()} />
            </section>
          ) : null}

          <section className="panel">
            <div className="folder-header">
              <div>
                <span className="label">Folders</span>
                <strong>{folderRollups.length.toLocaleString()} crates</strong>
              </div>
              <button type="button" className="small-button" onClick={() => selectFolder("all")}>
                All folders
              </button>
            </div>
            <div className="folder-grid">
              {folderRollups.map((rollup) => (
                <button
                  key={rollup.folder}
                  type="button"
                  className={`folder-card ${folderFilter === rollup.folder ? "active" : ""}`}
                  onClick={() => selectFolder(rollup.folder)}
                >
                  <span>{rollup.folder}</span>
                  <strong>{rollup.trackCount.toLocaleString()} tracks</strong>
                  <small>
                    {formatRuntime(rollup.runtimeSeconds)} / {formatBytes(rollup.totalBytes)}
                  </small>
                  <small>
                    {rollup.missingMetadataCount} metadata gaps | {rollup.newCount} new |{" "}
                    {rollup.changedCount} changed | {rollup.missingCount} missing
                  </small>
                </button>
              ))}
            </div>
            <div className="toolbar">
              <label>
                <span className="label">Search tracks</span>
                <input
                  placeholder="artist, title, album, path"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                <span className="label">Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="bulk-editor">
              <div>
                <span className="label">Bulk edit</span>
                <strong>{selectedPaths.size.toLocaleString()} selected</strong>
              </div>
              <input
                placeholder="artist"
                value={bulkForm.artist}
                onChange={(event) => setBulkForm({ ...bulkForm, artist: event.target.value })}
              />
              <input
                placeholder="album"
                value={bulkForm.album}
                onChange={(event) => setBulkForm({ ...bulkForm, album: event.target.value })}
              />
              <input
                placeholder="genre"
                value={bulkForm.genre}
                onChange={(event) => setBulkForm({ ...bulkForm, genre: event.target.value })}
              />
              <select
                value={bulkForm.proposed_bucket}
                onChange={(event) => setBulkForm({ ...bulkForm, proposed_bucket: event.target.value })}
              >
                <option value="">bucket</option>
                {bucketOptions.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {bucket}
                  </option>
                ))}
              </select>
              <button type="button" disabled={selectedPaths.size === 0} onClick={applyBulkEdit}>
                Apply
              </button>
              <button
                type="button"
                disabled={selectedPaths.size === 0 || isWritingTags}
                onClick={writeSelectedTags}
              >
                {isWritingTags ? "Writing..." : "Write tags"}
              </button>
              <button type="button" disabled={!summary || isRestoringTags} onClick={restoreLatestTagBackup}>
                {isRestoringTags ? "Restoring..." : "Restore backup"}
              </button>
            </div>
            {metadataStatus ? <p className="status">{metadataStatus}</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="select-cell">
                      <input
                        type="checkbox"
                        aria-label="Select all visible tracks"
                        checked={
                          filteredTracks.length > 0 &&
                          filteredTracks.every((track) => selectedPaths.has(track.path))
                        }
                        onChange={toggleVisibleTracks}
                      />
                    </th>
                    <th>Artist</th>
                    <th>Title</th>
                    <th>Album</th>
                    <th>Genre</th>
                    <th>Year</th>
                    <th>Runtime</th>
                    <th>Bucket</th>
                    <th>Readiness</th>
                    <th>Status</th>
                    <th>Tags</th>
                    <th>Save</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTracks.map((track) => (
                    <tr key={track.path}>
                      <td className="select-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select ${track.title || track.filename}`}
                          checked={selectedPaths.has(track.path)}
                          onChange={() => toggleTrack(track.path)}
                        />
                      </td>
                      <td>
                        <input
                          value={track.artist}
                          placeholder="artist"
                          onChange={(event) => updateTrackField(track.path, "artist", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={track.title}
                          placeholder={track.filename}
                          onChange={(event) => updateTrackField(track.path, "title", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={track.album}
                          placeholder="album"
                          onChange={(event) => updateTrackField(track.path, "album", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={track.genre}
                          placeholder="genre"
                          onChange={(event) => updateTrackField(track.path, "genre", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          value={track.year}
                          placeholder="year"
                          onChange={(event) => updateTrackField(track.path, "year", event.target.value)}
                        />
                      </td>
                      <td>{formatRuntime(track.duration_seconds)}</td>
                      <td>
                        <select
                          value={track.proposed_bucket}
                          aria-label="Bucket"
                          onChange={(event) =>
                            updateTrackField(track.path, "proposed_bucket", event.target.value)
                          }
                        >
                          {bucketOptions.map((bucket) => (
                            <option key={bucket} value={bucket}>
                              {bucket}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={track.live365_readiness}
                          aria-label="Readiness"
                          onChange={(event) =>
                            updateTrackField(track.path, "live365_readiness", event.target.value)
                          }
                        >
                          {readinessOptions.map((readiness) => (
                            <option key={readiness} value={readiness}>
                              {readiness}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`status-pill ${track.scan_status}`}>{track.scan_status}</td>
                      <td className={track.metadata_dirty ? "dirty-pill" : "status-pill"}>
                        {track.metadata_dirty ? "dirty" : track.tag_write_status}
                      </td>
                      <td>
                        <button type="button" className="small-button" onClick={() => saveTrack(track)}>
                          Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat panel">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

function formatRuntime(seconds: number | null) {
  if (seconds === null) return "Unknown";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
