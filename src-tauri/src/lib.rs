mod model;
mod secrets;
mod sidecar;
pub mod validation;
use sidecar::SidecarManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarManager::default())
        .manage(sidecar::GateState::default())
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_info,
            sidecar::sidecar_restart,
            sidecar::sidecar_send,
            sidecar::sidecar_stream,
            sidecar::set_gates,
            sidecar::sidecar_cancel,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            model::model_list,
            model::model_stream
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let mgr = app.state::<SidecarManager>();
            mgr.start(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building CODE NAME harness")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app_handle.state::<SidecarManager>().shutdown();
            }
        });
}
