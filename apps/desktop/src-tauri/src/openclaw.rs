use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_postgres::types::Type;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

// ---- Structs ----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawInstance {
    pub path: String,
    pub database_url: Option<String>,
    pub db_reachable: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub current_path: String,
    pub instances_found: usize,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawExtractedData {
    pub config: Vec<serde_json::Value>,
    pub sessions: Vec<serde_json::Value>,
    pub skills: Vec<serde_json::Value>,
    pub triggers: Vec<serde_json::Value>,
    pub workflows: Vec<serde_json::Value>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionProgress {
    pub table: String,
    pub rows_read: usize,
}

// ---- Helpers ----

fn to_camel_case(s: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = false;
    for ch in s.chars() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            result.push(ch.to_ascii_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }
    result
}

fn row_to_json(row: &tokio_postgres::Row) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let key = to_camel_case(col.name());
        let val: serde_json::Value = match *col.type_() {
            Type::TEXT | Type::VARCHAR => row
                .get::<_, Option<String>>(i)
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
            Type::UUID => row
                .get::<_, Option<uuid::Uuid>>(i)
                .map(|u| serde_json::Value::String(u.to_string()))
                .unwrap_or(serde_json::Value::Null),
            Type::INT4 => row
                .get::<_, Option<i32>>(i)
                .map(|n| serde_json::Value::Number(n.into()))
                .unwrap_or(serde_json::Value::Null),
            Type::INT8 => row
                .get::<_, Option<i64>>(i)
                .map(|n| serde_json::json!(n))
                .unwrap_or(serde_json::Value::Null),
            Type::JSONB | Type::JSON => row
                .get::<_, Option<serde_json::Value>>(i)
                .unwrap_or(serde_json::Value::Null),
            Type::BOOL => row
                .get::<_, Option<bool>>(i)
                .map(serde_json::Value::Bool)
                .unwrap_or(serde_json::Value::Null),
            _ => row
                .get::<_, Option<String>>(i)
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        };
        map.insert(key, val);
    }
    serde_json::Value::Object(map)
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join("openclaw"));
        paths.push(home.join("OpenClaw"));
        paths.push(home.join("projects").join("openclaw"));
        paths.push(home.join("src").join("openclaw"));
    }
    paths.push(PathBuf::from("/opt/openclaw"));
    paths.push(PathBuf::from("/usr/local/openclaw"));
    paths
}

fn is_openclaw_dir(path: &PathBuf) -> bool {
    let pkg = path.join("package.json");
    if let Ok(content) = std::fs::read_to_string(&pkg) {
        content.to_lowercase().contains("openclaw")
    } else {
        false
    }
}

fn find_database_url(path: &PathBuf) -> Option<String> {
    // Check ~/.openclaw/config.json
    if let Some(home) = dirs::home_dir() {
        let config_path = home.join(".openclaw").join("config.json");
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(url) = json.get("database_url").and_then(|v| v.as_str()) {
                    return Some(url.to_string());
                }
            }
        }
    }

    // Check {dir}/.env for DATABASE_URL=
    let env_path = path.join(".env");
    if let Ok(content) = std::fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(val) = trimmed.strip_prefix("DATABASE_URL=") {
                let val = val.trim().trim_matches('"').trim_matches('\'');
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }

    None
}

async fn connect_with_timeout(
    url: &str,
) -> Result<(tokio_postgres::Client, tokio::task::JoinHandle<()>), String> {
    let connect_fut = tokio_postgres::connect(url, tokio_postgres::NoTls);
    let (client, connection) = tokio::time::timeout(CONNECT_TIMEOUT, connect_fut)
        .await
        .map_err(|_| format!("Connection timed out after {}s", CONNECT_TIMEOUT.as_secs()))?
        .map_err(|e| format!("Failed to connect: {e}"))?;

    let handle = tokio::spawn(async move {
        let _ = connection.await;
    });

    Ok((client, handle))
}

async fn test_db_connection(url: &str) -> bool {
    match connect_with_timeout(url).await {
        Ok((client, handle)) => {
            let ok = client.simple_query("SELECT 1").await.is_ok();
            drop(client);
            handle.abort();
            ok
        }
        Err(_) => false,
    }
}

// ---- Commands ----

#[tauri::command]
pub async fn scan_openclaw_instances(
    app: AppHandle,
) -> Result<Vec<OpenClawInstance>, String> {
    let mut instances = Vec::new();
    let paths = candidate_paths();

    for path in &paths {
        let _ = app.emit(
            "openclaw-scan-progress",
            ScanProgress {
                phase: "scanning".to_string(),
                current_path: path.display().to_string(),
                instances_found: instances.len(),
            },
        );

        if !path.exists() || !is_openclaw_dir(path) {
            continue;
        }

        let db_url = find_database_url(path);
        let mut db_reachable = false;

        if let Some(ref url) = db_url {
            let _ = app.emit(
                "openclaw-scan-progress",
                ScanProgress {
                    phase: "checking_db".to_string(),
                    current_path: path.display().to_string(),
                    instances_found: instances.len(),
                },
            );
            db_reachable = test_db_connection(url).await;
        }

        instances.push(OpenClawInstance {
            path: path.display().to_string(),
            database_url: db_url,
            db_reachable,
        });
    }

    let _ = app.emit(
        "openclaw-scan-progress",
        ScanProgress {
            phase: "done".to_string(),
            current_path: String::new(),
            instances_found: instances.len(),
        },
    );

    Ok(instances)
}

#[tauri::command]
pub async fn extract_openclaw_data(
    app: AppHandle,
    database_url: String,
) -> Result<OpenClawExtractedData, String> {
    let (client, conn_handle) = connect_with_timeout(&database_url).await?;

    let tables: Vec<(&str, &str)> = vec![
        ("config", "SELECT id, agent_id, key, value FROM config"),
        ("sessions", "SELECT id, agent_id, state FROM sessions"),
        (
            "skills",
            "SELECT id, agent_id, name, content, version FROM skills",
        ),
        (
            "triggers",
            "SELECT id, name, pattern_type, pattern_config, action_type, action_config FROM triggers",
        ),
        (
            "workflows",
            "SELECT id, name, definition FROM workflows",
        ),
    ];

    let mut data_map: HashMap<String, Vec<serde_json::Value>> = HashMap::new();

    for (table_name, query) in &tables {
        let query_fut = client.query(*query, &[]);
        let rows = tokio::time::timeout(QUERY_TIMEOUT, query_fut)
            .await
            .map_err(|_| {
                format!(
                    "Query on {table_name} timed out after {}s",
                    QUERY_TIMEOUT.as_secs()
                )
            })?
            .map_err(|e| format!("Failed to query {table_name}: {e}"))?;

        let json_rows: Vec<serde_json::Value> =
            rows.iter().map(|r| row_to_json(r)).collect();

        let _ = app.emit(
            "openclaw-extract-progress",
            ExtractionProgress {
                table: table_name.to_string(),
                rows_read: json_rows.len(),
            },
        );

        data_map.insert(table_name.to_string(), json_rows);
    }

    // Clean up connection
    drop(client);
    conn_handle.abort();

    Ok(OpenClawExtractedData {
        config: data_map.remove("config").unwrap_or_default(),
        sessions: data_map.remove("sessions").unwrap_or_default(),
        skills: data_map.remove("skills").unwrap_or_default(),
        triggers: data_map.remove("triggers").unwrap_or_default(),
        workflows: data_map.remove("workflows").unwrap_or_default(),
    })
}
