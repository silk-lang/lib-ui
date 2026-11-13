// The page reports `bench:` lines through this command; run.mjs reads them on standard output.
use std::io::Write;

#[tauri::command]
fn bench(line: String) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bench])
        .run(tauri::generate_context!())
        .expect("the Tauri app failed");
}
