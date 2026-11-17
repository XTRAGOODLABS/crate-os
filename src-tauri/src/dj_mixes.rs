use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

// Keep the embedded runtime separate from a standalone GOOD MIXX installation,
// which conventionally listens on 8770.
const PORT: u16 = 18770;

#[derive(Default)]
pub struct DjMixesState {
    child: Mutex<Option<Child>>,
    connection: Mutex<Option<DjMixesConnection>>,
}

#[derive(Clone)]
struct DjMixesConnection {
    lan_mode: bool,
    token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DjMixesStatus {
    running: bool,
    lan_mode: bool,
    local_url: Option<String>,
    lan_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DjMixesStartResponse {
    message: String,
    status: DjMixesStatus,
    migrated_files: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DjMixesImportResponse {
    imported: Vec<String>,
    skipped: Vec<String>,
    source_found: bool,
}

fn health_check() -> bool {
    health_body().is_some()
}

/// The /health reply from whatever GOOD MIXX helper is on the port, if any.
fn health_body() -> Option<String> {
    let addr: SocketAddr = format!("127.0.0.1:{PORT}")
        .parse()
        .expect("fixed local address");
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return None;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return None;
    }
    let mut response = String::new();
    (stream.read_to_string(&mut response).is_ok()
        && response.contains("200 OK")
        && response.contains("crate-os-good-mixx"))
    .then_some(response)
}

/// Waits up to 6 seconds for an orphaned GOOD MIXX helper to shut itself down.
fn wait_for_port_release() -> bool {
    for _ in 0..30 {
        if !health_check() {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn local_url(connection: &DjMixesConnection) -> String {
    let mut url = format!("http://127.0.0.1:{PORT}/mixes");
    if let Some(token) = &connection.token {
        url.push_str("?token=");
        url.push_str(token);
    }
    url
}

fn local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn status_from(connection: Option<DjMixesConnection>) -> DjMixesStatus {
    if !health_check() {
        return DjMixesStatus {
            running: false,
            lan_mode: false,
            local_url: None,
            lan_url: None,
        };
    }
    let connection = connection.unwrap_or(DjMixesConnection {
        lan_mode: false,
        token: None,
    });
    let lan_url = if connection.lan_mode {
        local_ip().map(|ip| {
            format!(
                "http://{ip}:{PORT}/mixes?token={}",
                connection.token.as_deref().unwrap_or_default()
            )
        })
    } else {
        None
    };
    DjMixesStatus {
        running: true,
        lan_mode: connection.lan_mode,
        local_url: Some(local_url(&connection)),
        lan_url,
    }
}

#[tauri::command]
pub fn dj_mixes_status(state: State<'_, DjMixesState>) -> Result<DjMixesStatus, String> {
    // Only report the helper this Crate OS started. Anything else on the port (for example a
    // helper left over from an older build) must not be shown, so the app starts its own.
    if state
        .child
        .lock()
        .map_err(|_| "DJ Mixes process state is unavailable.".to_string())?
        .is_none()
    {
        return Ok(DjMixesStatus {
            running: false,
            lan_mode: false,
            local_url: None,
            lan_url: None,
        });
    }
    let connection = state
        .connection
        .lock()
        .map_err(|_| "DJ Mixes state is unavailable.".to_string())?
        .clone();
    Ok(status_from(connection))
}

fn executable_path(app: &AppHandle) -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let beside_app = current
        .parent()
        .ok_or("Could not locate the Crate OS executable folder.")?
        .join("dj-mixes-server");
    if beside_app.is_file() {
        return Ok(beside_app);
    }
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("dj-mixes-runtime")
        .join("dj-mixes-server");
    if resource.is_file() {
        return Ok(resource);
    }
    Err("The bundled DJ Mixes runtime is missing. Reinstall Crate OS or rebuild the DJ Mixes sidecar.".to_string())
}

fn runtime_asset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("dj-mixes-runtime");
    if path.join("mixes.html").is_file() && path.join("tools/djay_deck_keys.js").is_file() {
        Ok(path)
    } else {
        Err(format!(
            "DJ Mixes interface resources are missing from {}.",
            path.display()
        ))
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("DJ Mixes");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
    Ok(path)
}

fn import_legacy_files(destination: &Path) -> Result<DjMixesImportResponse, String> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Ok(DjMixesImportResponse {
            imported: Vec::new(),
            skipped: Vec::new(),
            source_found: false,
        });
    };
    let source = home.join("Portal-Stems-FX").join("data");
    if !source.is_dir() {
        return Ok(DjMixesImportResponse {
            imported: Vec::new(),
            skipped: Vec::new(),
            source_found: false,
        });
    }
    let mut response = DjMixesImportResponse {
        imported: Vec::new(),
        skipped: Vec::new(),
        source_found: true,
    };
    for filename in [
        "mixes.json",
        "library.json",
        "djay_screen_keys.json",
        "traktor_history.json",
    ] {
        let from = source.join(filename);
        let to = destination.join(filename);
        if !from.is_file() {
            continue;
        }
        if to.exists() {
            response.skipped.push(filename.to_string());
            continue;
        }
        fs::copy(&from, &to)
            .map_err(|error| format!("Could not import {}: {error}", from.display()))?;
        response.imported.push(filename.to_string());
    }
    Ok(response)
}

#[tauri::command]
pub fn import_legacy_dj_mixes_data(app: AppHandle) -> Result<DjMixesImportResponse, String> {
    let destination = data_dir(&app)?;
    import_legacy_files(&destination)
}

fn stop_child(state: &DjMixesState) -> Result<(), String> {
    let mut child = state
        .child
        .lock()
        .map_err(|_| "DJ Mixes process state is unavailable.".to_string())?;
    if let Some(process) = child.as_mut() {
        // Ask politely first: the packaged helper passes SIGTERM on to its server, but a
        // hard kill would leave that server running and still holding the port.
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(process.id().to_string())
            .status();
        for _ in 0..30 {
            if matches!(process.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = process.kill();
        let _ = process.wait();
    }
    *child = None;
    *state
        .connection
        .lock()
        .map_err(|_| "DJ Mixes connection state is unavailable.".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn stop_dj_mixes(state: State<'_, DjMixesState>) -> Result<(), String> {
    stop_child(&state)
}

pub fn stop_on_exit(app: &AppHandle) {
    let state = app.state::<DjMixesState>();
    let _ = stop_child(&state);
}

#[tauri::command]
pub fn start_dj_mixes(
    app: AppHandle,
    state: State<'_, DjMixesState>,
    lan_mode: Option<bool>,
) -> Result<DjMixesStartResponse, String> {
    let requested_lan = lan_mode.unwrap_or(false);
    let current_connection = state
        .connection
        .lock()
        .map_err(|_| "DJ Mixes connection state is unavailable.".to_string())?
        .clone();
    if health_check() {
        if current_connection
            .as_ref()
            .is_some_and(|connection| connection.lan_mode == requested_lan)
        {
            return Ok(DjMixesStartResponse {
                message: "DJ Mixes is already running.".to_string(),
                status: status_from(current_connection),
                migrated_files: Vec::new(),
            });
        }
        if state
            .child
            .lock()
            .map_err(|_| "DJ Mixes process state is unavailable.".to_string())?
            .is_none()
        {
            // A helper left behind by a crashed Crate OS stops itself within a few seconds.
            if !wait_for_port_release() {
                return Err(format!(
                    "An older GOOD MIXX helper is still running on port {PORT}. Open Activity Monitor, search \"dj-mixes-server\", quit it, then press Reconnect."
                ));
            }
        }
        stop_child(&state)?;
        if !wait_for_port_release() {
            return Err(format!(
                "The previous GOOD MIXX helper is still running on port {PORT}. Wait a moment, then press Reconnect."
            ));
        }
    }

    let executable = executable_path(&app)?;
    let assets = runtime_asset_dir(&app)?;
    let destination = data_dir(&app)?;
    let migration = import_legacy_files(&destination)?;
    let logs = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("dj-mixes.log"))
        .map_err(|error| error.to_string())?;
    let stderr_path = logs.join("dj-mixes-error.log");
    let stderr = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&stderr_path)
        .map_err(|error| error.to_string())?;
    let token = requested_lan.then(|| Uuid::new_v4().simple().to_string());
    // Lets us confirm the server that answers is the one just started, not a leftover.
    let instance = Uuid::new_v4().simple().to_string();
    let connection = DjMixesConnection {
        lan_mode: requested_lan,
        token: token.clone(),
    };
    let mut command = Command::new(executable);
    command
        .env(
            "CRATE_OS_DJ_MIXES_HOST",
            if requested_lan {
                "0.0.0.0"
            } else {
                "127.0.0.1"
            },
        )
        .env("CRATE_OS_DJ_MIXES_PORT", PORT.to_string())
        .env("CRATE_OS_DJ_MIXES_ASSET_DIR", &assets)
        .env("CRATE_OS_DJ_MIXES_DATA_DIR", &destination)
        .env(
            "CRATE_OS_DJ_MIXES_PARENT_PID",
            std::process::id().to_string(),
        )
        .env("CRATE_OS_DJ_MIXES_INSTANCE", &instance)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    if let Some(token) = &token {
        command.env("CRATE_OS_DJ_MIXES_TOKEN", token);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Could not start the bundled DJ Mixes runtime: {error}"))?;
    *state
        .child
        .lock()
        .map_err(|_| "DJ Mixes process state is unavailable.".to_string())? = Some(child);
    *state
        .connection
        .lock()
        .map_err(|_| "DJ Mixes connection state is unavailable.".to_string())? =
        Some(connection.clone());

    // The bundled helper unpacks itself on first launch, which can take several seconds.
    for _ in 0..300 {
        if health_body().is_some_and(|body| body.contains(&instance)) {
            return Ok(DjMixesStartResponse {
                message: if requested_lan {
                    "DJ Mixes started in protected LAN mode.".to_string()
                } else {
                    "DJ Mixes started locally.".to_string()
                },
                status: status_from(Some(connection)),
                migrated_files: migration.imported,
            });
        }
        thread::sleep(Duration::from_millis(100));
    }
    stop_child(&state)?;
    let details = fs::read_to_string(&stderr_path).unwrap_or_default();
    let details = details
        .lines()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Err(if details.is_empty() {
        format!("DJ Mixes did not start. Check {}.", stderr_path.display())
    } else {
        format!("DJ Mixes did not start:\n{details}")
    })
}

fn open_url(url: &str) -> Result<(), String> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open DJ Mixes in the browser.".to_string())
    }
}

#[tauri::command]
pub fn open_dj_mixes_browser(state: State<'_, DjMixesState>) -> Result<(), String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "DJ Mixes connection state is unavailable.".to_string())?
        .clone()
        .ok_or("DJ Mixes is not running.")?;
    open_url(&local_url(&connection))
}

fn open_traktor_command(app: &AppHandle, filename: &str) -> Result<(), String> {
    let command = runtime_asset_dir(app)?.join(filename);
    if !command.is_file() {
        return Err(format!("The bundled {filename} helper is missing."));
    }
    let status = Command::new("open")
        .arg(&command)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Could not open {}.", command.display()))
    }
}

#[tauri::command]
pub fn open_traktor_link_installer(app: AppHandle) -> Result<(), String> {
    open_traktor_command(&app, "Add Traktor Link.command")
}

#[tauri::command]
pub fn open_traktor_link_remover(app: AppHandle) -> Result<(), String> {
    open_traktor_command(&app, "Remove Traktor Link.command")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_mode_does_not_expose_a_token() {
        let connection = DjMixesConnection {
            lan_mode: false,
            token: None,
        };
        assert_eq!(local_url(&connection), "http://127.0.0.1:18770/mixes");
    }

    #[test]
    fn lan_mode_uses_one_time_connection_token_in_url() {
        let connection = DjMixesConnection {
            lan_mode: true,
            token: Some("secret-token".to_string()),
        };
        assert_eq!(
            local_url(&connection),
            "http://127.0.0.1:18770/mixes?token=secret-token"
        );
    }
}
