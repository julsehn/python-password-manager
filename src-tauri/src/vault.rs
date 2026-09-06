// Vault operations module for Tauri

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
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
    pub folders: Vec<Folder>,
    pub deleted_entries: Vec<TrashedEntry>,
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
