import { invoke } from "./lib/errorLog";
import { useMemo, useState } from "react";

type PlaylistTrack = {
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  duration_seconds: number | null;
  scan_status: string;
};

function trackLabel(track: PlaylistTrack) {
  const title = track.title || track.filename;
  return track.artist ? `${track.artist} — ${title}` : title;
}

function durationLabel(seconds: number) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`
    : `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export default function PlaylistBuilder({ tracks }: { tracks: PlaylistTrack[] }) {
  const [name, setName] = useState("New Crate");
  const [query, setQuery] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const available = useMemo(() => tracks.filter(track => track.scan_status !== "missing"), [tracks]);
  const byPath = useMemo(() => new Map(available.map(track => [track.path, track])), [available]);
  const selectedPaths = useMemo(() => new Set(paths), [paths]);
  const crate = paths.map(path => byPath.get(path)).filter((track): track is PlaylistTrack => Boolean(track));
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return available
      .filter(track => !selectedPaths.has(track.path))
      .filter(track => !normalized || [track.artist, track.title, track.album, track.filename]
        .join(" ").toLowerCase().includes(normalized))
      .slice(0, 200);
  }, [available, query, selectedPaths]);
  const runtime = crate.reduce((sum, track) => sum + (track.duration_seconds ?? 0), 0);

  function move(index: number, offset: number) {
    // Positions come from the visible crate, so reorder that list (it skips tracks missing after a rescan).
    const visible = crate.map(track => track.path);
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= visible.length) return;
    [visible[index], visible[nextIndex]] = [visible[nextIndex], visible[index]];
    setPaths(visible);
  }

  async function save(format: "m3u8" | "csv") {
    setStatus("");
    try {
      const result = await invoke<{ path: string }>("save_playlist", {
        args: { name, paths, format },
      });
      setStatus(`Saved ${result.path}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  return <section className="playlist-builder">
    <div className="playlist-builder-head">
      <div>
        <span className="label">Crate Builder</span>
        <h2>Build a playlist in play order</h2>
      </div>
      <label>
        <span className="label">Playlist name</span>
        <input value={name} onChange={event => setName(event.target.value)} />
      </label>
    </div>
    <div className="playlist-builder-grid">
      <div className="playlist-source">
        <label>
          <span className="label">Find tracks</span>
          <input
            type="search"
            placeholder="artist, title, album"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <p className="playlist-count">{filtered.length.toLocaleString()} shown · {available.length.toLocaleString()} available</p>
        <ol className="playlist-track-list">
          {filtered.map(track => <li key={track.path}>
            <div><strong>{trackLabel(track)}</strong><small>{track.album || track.path}</small></div>
            <button type="button" onClick={() => setPaths(current => [...current, track.path])}>Add</button>
          </li>)}
        </ol>
      </div>
      <div className="playlist-draft">
        <div className="playlist-draft-summary">
          <div><span className="label">Current crate</span><strong>{crate.length} tracks · {durationLabel(runtime)}</strong></div>
          <button type="button" disabled={!crate.length} onClick={() => setPaths([])}>Clear</button>
        </div>
        {crate.length ? <ol className="playlist-track-list ordered">
          {crate.map((track, index) => <li key={track.path}>
            <span className="playlist-order">{index + 1}</span>
            <div><strong>{trackLabel(track)}</strong><small>{durationLabel(track.duration_seconds ?? 0)}</small></div>
            <div className="playlist-row-actions">
              <button type="button" disabled={index === 0} aria-label={`Move ${trackLabel(track)} up`} onClick={() => move(index, -1)}>↑</button>
              <button type="button" disabled={index === crate.length - 1} aria-label={`Move ${trackLabel(track)} down`} onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label={`Remove ${trackLabel(track)}`} onClick={() => setPaths(current => current.filter(path => path !== track.path))}>Remove</button>
            </div>
          </li>)}
        </ol> : <p className="empty">Add tracks from the library to begin a crate.</p>}
        <div className="playlist-save-actions">
          <button type="button" disabled={!crate.length || !name.trim()} onClick={() => void save("m3u8")}>Save M3U8</button>
          <button type="button" disabled={!crate.length || !name.trim()} onClick={() => void save("csv")}>Save CSV</button>
          <button type="button" onClick={() => void invoke("open_exports_folder")}>Open exports</button>
        </div>
        {status ? <p className="status">{status}</p> : null}
      </div>
    </div>
  </section>;
}
