//! Problem reports for Crate OS.
//!
//! Errors are kept in a small log file on this Mac. Nothing is sent anywhere:
//! "Report a problem" only opens the GitHub form with the details filled in,
//! and the person decides whether to submit it.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

pub const ISSUE_URL: &str = "https://github.com/XTRAGOODLABS/crate-os/issues/new";
const MAX_LINES: usize = 200; // lines kept in the log file
const REPORT_LINES: usize = 25; // most recent lines put into a report
const REPORT_CHARS: usize = 1800; // keeps the link short enough for browsers

static LOG_FILE: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Where the log lives: `<app data>/logs/crate-os-errors.log`.
pub fn init(app_data_dir: &Path) -> PathBuf {
    let file = app_data_dir.join("logs").join("crate-os-errors.log");
    let _ = LOG_FILE.set(file.clone());
    install_panic_hook();
    file
}

pub fn log_file() -> Option<&'static PathBuf> {
    LOG_FILE.get()
}

/// Hides the person's user name in folder paths before anything is shown or shared.
pub fn scrub(text: &str) -> String {
    let mut out = text.to_string();
    if let Some(home) = std::env::var_os("HOME") {
        let home = home.to_string_lossy().to_string();
        if home.len() > 1 {
            out = out.replace(&home, "~");
        }
    }
    // any other /Users/<name>
    let mut result = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(i) = rest.find("/Users/") {
        result.push_str(&rest[..i]);
        result.push_str("/Users/~");
        let after = &rest[i + "/Users/".len()..];
        let end = after
            .find(|c: char| c == '/' || c.is_whitespace())
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    result.push_str(rest);
    result
}

fn read_lines(file: &Path) -> Vec<String> {
    fs::read_to_string(file)
        .map(|text| text.lines().filter(|l| !l.is_empty()).map(String::from).collect())
        .unwrap_or_default()
}

pub fn record_to(file: &Path, source: &str, message: &str) {
    let clean = scrub(message).split_whitespace().collect::<Vec<_>>().join(" ");
    let mut line = format!("{} [{}] {}", chrono::Local::now().format("%Y-%m-%dT%H:%M:%S"), source, clean);
    if line.chars().count() > 600 {
        line = line.chars().take(600).collect();
    }
    let _guard = WRITE_LOCK.lock();
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let mut lines = read_lines(file);
    lines.push(line);
    let start = lines.len().saturating_sub(MAX_LINES);
    let _ = fs::write(file, lines[start..].join("\n") + "\n"); // logging must never break the app
}

pub fn record(source: &str, message: &str) {
    if let Some(file) = LOG_FILE.get() {
        record_to(file, source, message);
    }
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record("app", &format!("crash: {info}"));
        previous(info);
    }));
}

fn run_text(cmd: &str, args: &[&str]) -> String {
    Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn mac_description() -> String {
    let chip = run_text("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"]);
    let version = run_text("/usr/bin/sw_vers", &["-productVersion"]);
    let chip = if chip.is_empty() { std::env::consts::ARCH.to_string() } else { chip };
    let version = if version.is_empty() { "unknown".to_string() } else { version };
    format!("{chip}, macOS {version}")
}

/// Percent-encodes a value for a link (letters, digits and -._~ stay as they are).
fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn report_url_from(file: Option<&Path>, version: &str, mac: &str) -> String {
    let lines = file.map(read_lines).unwrap_or_default();
    let start = lines.len().saturating_sub(REPORT_LINES);
    let mut recent = lines[start..].join("\n");
    if recent.chars().count() > REPORT_CHARS {
        let skip = recent.chars().count() - REPORT_CHARS;
        recent = format!("…{}", recent.chars().skip(skip).collect::<String>());
    }
    if recent.is_empty() {
        recent = "No errors were logged.".to_string();
    }
    format!(
        "{ISSUE_URL}?template=bug_report.yml&version={}&mac={}&error={}",
        encode(version),
        encode(mac),
        encode(&recent)
    )
}

pub fn report_url(version: &str) -> String {
    report_url_from(LOG_FILE.get().map(|p| p.as_path()), version, &mac_description())
}

pub fn idea_url() -> String {
    format!("{ISSUE_URL}?template=idea.yml")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("crate-os-errors-{name}-{}", uuid::Uuid::new_v4()));
        dir.join("logs").join("crate-os-errors.log")
    }

    #[test]
    fn hides_user_names() {
        let home = std::env::var("HOME").unwrap_or_default();
        let text = scrub(&format!("failed at {home}/Music/a.mp3 and /Users/someone/b.wav"));
        assert!(!text.contains("/Users/someone"));
        if home.len() > 1 {
            assert!(!text.contains(&home));
            assert!(text.contains("~/Music/a.mp3"));
        }
    }

    #[test]
    fn log_stays_small_and_report_is_filled_in() {
        let file = temp_file("small");
        for i in 0..260 {
            record_to(&file, "app", &format!("problem {i} {}", "x".repeat(80)));
        }
        assert_eq!(read_lines(&file).len(), 200);
        let url = report_url_from(Some(&file), "0.2.0-beta.1", "Apple M4, macOS 15.5");
        assert!(url.starts_with("https://github.com/XTRAGOODLABS/crate-os/issues/new?template=bug_report.yml&version=0.2.0-beta.1&mac=Apple%20M4%2C%20macOS%2015.5&error="));
        assert!(url.contains("problem%20259"));
        assert!(url.len() < 7000);
    }

    #[test]
    fn empty_report_says_so() {
        let url = report_url_from(None, "1", "Mac");
        assert!(url.ends_with("error=No%20errors%20were%20logged."));
    }
}
