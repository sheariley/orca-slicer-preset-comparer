// Keep Rust minimal: the app's logic lives in TypeScript. Host access goes through Tauri's
// official plugins, scoped in capabilities/. The only custom code is OrcaSlicer's preset lock.
use std::collections::HashMap;
use std::fs::{File, OpenOptions, TryLockError};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// How long to wait for OrcaSlicer to release its lock before giving up on a save.
const LOCK_TIMEOUT: Duration = Duration::from_secs(2);

/// The error `lock_user_presets` returns when the lock stays taken past `LOCK_TIMEOUT`
/// (tauri-file-system.ts turns it into a `busy` error).
const LOCK_BUSY: &str = "busy";

/// Locks held for the TypeScript side, by token. Dropping a `File` releases its lock.
#[derive(Default)]
struct PresetLocks(Mutex<(u32, HashMap<u32, File>)>);

/// Takes OrcaSlicer's user-preset lock: an OS lock on `<data folder>/user.lock`, the file
/// OrcaSlicer's `InstanceLock` locks around every user-preset read and write. `File::lock`
/// uses the same calls OrcaSlicer does (LockFileEx on Windows, flock elsewhere), so the two
/// programs exclude each other. Only this one file can be locked. Returns a token for
/// `unlock_user_presets`. Fails with exactly `LOCK_BUSY` when the lock stays taken.
#[tauri::command]
async fn lock_user_presets(app: tauri::AppHandle) -> Result<u32, String> {
    let path = app
        .path()
        .config_dir()
        .map_err(|error| error.to_string())?
        .join("OrcaSlicer")
        .join("user.lock");
    let file = tauri::async_runtime::spawn_blocking(move || -> Result<File, String> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        let deadline = Instant::now() + LOCK_TIMEOUT;
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(file),
                Err(TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(TryLockError::WouldBlock) => {
                    return Err(LOCK_BUSY.into());
                }
                Err(TryLockError::Error(error)) => return Err(error.to_string()),
            }
        }
    })
    .await
    .map_err(|error| error.to_string())??;

    let locks = app.state::<PresetLocks>();
    let mut held = locks.0.lock().map_err(|error| error.to_string())?;
    held.0 += 1;
    let token = held.0;
    held.1.insert(token, file);
    Ok(token)
}

/// Releases a lock taken by `lock_user_presets`.
#[tauri::command]
fn unlock_user_presets(app: tauri::AppHandle, token: u32) -> Result<(), String> {
    let locks = app.state::<PresetLocks>();
    let mut held = locks.0.lock().map_err(|error| error.to_string())?;
    held.1.remove(&token);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .manage(PresetLocks::default())
        .invoke_handler(tauri::generate_handler![lock_user_presets, unlock_user_presets])
        .run(tauri::generate_context!())
        .expect("error while running the preset comparer");
}
