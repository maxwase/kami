use std::fmt;

enum PostureType {
    Continuous,
    Folded,
    HalfOpened,
    Flipped,
}

impl PostureType {
    fn from_angle(angle_deg: f64) -> Self {
        let normalized = ((angle_deg % 360.0) + 360.0) % 360.0;
        if (170.0..=190.0).contains(&normalized) {
            return PostureType::Continuous;
        }
        if (190.0..350.0).contains(&normalized) {
            return PostureType::Flipped;
        }
        if normalized <= 30.0 || normalized >= 350.0 {
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
            PostureType::Flipped => "flipped",
        }
        .fmt(f)
    }
}

#[tauri::command]
fn read_hinge_angle() -> Result<f64, String> {
    Ok(42.0)
}

#[tauri::command]
fn read_posture_type() -> Result<String, String> {
    let angle = read_hinge_angle()?;
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
