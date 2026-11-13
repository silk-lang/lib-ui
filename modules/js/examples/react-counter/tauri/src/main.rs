// The starter page in Tauri. Links open through the opener plugin; the page's `log` lines
// (its first frame) are printed on standard output.
use std::io::Write;

#[tauri::command]
fn log(line: String) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![log])
        .run(tauri::generate_context!())
        .expect("the Tauri app failed");
}
