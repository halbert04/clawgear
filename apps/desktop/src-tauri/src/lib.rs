mod openclaw;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use std::sync::Mutex;

struct TrayState {
    status: String, // "healthy", "warning", "error"
}

#[tauri::command]
fn update_tray_status(app: AppHandle, status: String) -> Result<(), String> {
    let state = app.state::<Mutex<TrayState>>();
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.status = status.clone();

    // Update tray tooltip to reflect status
    if let Some(tray) = app.tray_by_id("main-tray") {
        let tooltip = match status.as_str() {
            "warning" => "ClawGear - Warnings",
            "error" => "ClawGear - Errors detected",
            _ => "ClawGear - Healthy",
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }

    // Emit event to frontend so it can update if needed
    let _ = app.emit("tray-status-changed", &status);
    Ok(())
}

#[tauri::command]
fn get_tray_status(app: AppHandle) -> Result<String, String> {
    let state = app.state::<Mutex<TrayState>>();
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.status.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Mutex::new(TrayState {
            status: "healthy".to_string(),
        }))
        .setup(|app| {
            // Build tray menu
            let show_i = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            // Build tray icon
            let _tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("ClawGear - Healthy")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_tray_status,
            get_tray_status,
            openclaw::scan_openclaw_instances,
            openclaw::extract_openclaw_data,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            // Close-to-tray: hide window instead of closing
            if let RunEvent::WindowEvent { label, event: window_event, .. } = &event {
                if label == "main" {
                    if let WindowEvent::CloseRequested { api, .. } = window_event {
                        // Prevent the window from closing
                        api.prevent_close();
                        // Hide the window instead
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
            }
        });
}
