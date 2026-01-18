use std::fmt;

use hinge_angle::HingeAngle;

enum PostureType {
    Continuous,
    Folded,
    HalfOpened,
}

impl PostureType {
    fn from_angle(angle_deg: f64) -> Self {
        let normalized = ((angle_deg % 360.0) + 360.0) % 360.0;
        if normalized > 90.0 {
            return PostureType::Continuous;
        }
        if normalized <= 60.0 {
            return PostureType::Folded;
        }
        PostureType::HalfOpened
    }
}

impl fmt::Display for PostureType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PostureType::Continuous => "continuous",
            PostureType::Folded => "folded",
            PostureType::HalfOpened => "half-opened",
        }
        .fmt(f)
    }
}

#[cfg(target_os = "macos")]
async fn read_platform_hinge_angle() -> Result<f64, String> {
    use std::sync::OnceLock;

    use hinge_angle::macos::Hinge;
    use tauri::async_runtime::Mutex;

    static SENSOR: OnceLock<Result<Mutex<Hinge>, hinge_angle::macos::Error>> = OnceLock::new();

    let hinge = SENSOR.get_or_init(|| Hinge::new().map(Mutex::new));

    let angle = hinge
        .as_ref()
        .map_err(|err| err.to_string())?
        .lock()
        .await
        .angle()
        .map_err(|err| err.to_string())?;

    Ok(angle as f64)
}

#[cfg(not(target_os = "macos"))]
fn read_platform_hinge_angle() -> Result<f64, String> {
    Err("Platform not supported")
}

#[tauri::command]
async fn read_hinge_angle() -> Result<f64, String> {
    read_platform_hinge_angle().await
}

#[tauri::command]
async fn read_posture_type() -> Result<String, String> {
    let angle = read_hinge_angle().await?;
    let posture = PostureType::from_angle(angle);
    Ok(posture.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_hinge_angle,
            read_posture_type
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
