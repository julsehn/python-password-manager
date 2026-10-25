use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashedEntry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub kind: String,
    pub value: String,
    pub language: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultData {
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub deleted_entries: Vec<TrashedEntry>,
    #[serde(default)]
    pub history: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultState {
    pub is_new: bool,
    pub entries: Vec<Entry>,
    pub folders: Vec<Folder>,
    pub trash: Vec<TrashedEntry>,
    pub history: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInfo {
    pub exists: bool,
    pub entry_count: usize,
    pub folder_count: usize,
    pub trash_count: usize,
}

pub(super) fn visible_trash(
    trash: impl IntoIterator<Item = TrashedEntry>,
    now: i64,
) -> Vec<TrashedEntry> {
    trash
        .into_iter()
        .filter(|entry| entry.deleted_at.parse::<i64>().unwrap_or(0) <= now)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{visible_trash, TrashedEntry, VaultData};

    #[test]
    fn legacy_vault_data_defaults_new_fields() {
        let data: VaultData = serde_json::from_str(
            r#"{"entries":[{"id":"1","site":"example.test","username":"user","password":"secret","notes":"","created_at":"2024-01-01","updated_at":null}]}"#,
        )
        .unwrap();

        assert!(data.folders.is_empty());
        assert!(data.deleted_entries.is_empty());
        assert!(data.history.is_empty());
        assert!(data.entries[0].folder_id.is_none());
        assert!(data.entries[0].deleted_at.is_none());
    }

    #[test]
    fn visible_trash_keeps_expired_and_boundary_entries() {
        let entry = |id: &str, deleted_at: &str| TrashedEntry {
            id: id.to_string(),
            site: "example.test".to_string(),
            username: "user".to_string(),
            password: "secret".to_string(),
            notes: String::new(),
            folder_id: None,
            created_at: String::new(),
            updated_at: None,
            deleted_at: deleted_at.to_string(),
        };

        let visible = visible_trash(
            vec![
                entry("expired", "99"),
                entry("boundary", "100"),
                entry("future", "101"),
            ],
            100,
        );

        assert_eq!(
            visible
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            vec!["expired", "boundary"]
        );
    }
}
