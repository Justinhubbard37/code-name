//! OS keychain-backed secret storage (Phase 2.4).
//!
//! API keys live in the platform credential store (Windows Credential Manager /
//! macOS Keychain / Linux Secret Service), never in a plain-text file. The
//! webview sets/reads them through these commands; each secret is keyed by the
//! same name used for the env-var fallback (e.g. "GEMINI_API_KEY").

const SERVICE: &str = "com.codename.harness";

use crate::validation::{redact_secrets, validate_secret_name};

fn sanitize_error(error: impl ToString) -> String {
    redact_secrets(&error.to_string())
}

fn validate_secret_command_name(name: &str) -> Result<(), String> {
    validate_secret_name(name).map_err(sanitize_error)
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    validate_secret_command_name(&name)?;
    let entry = keyring::Entry::new(SERVICE, &name).map_err(sanitize_error)?;
    entry.set_password(&value).map_err(sanitize_error)
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    validate_secret_command_name(&name)?;
    let entry = keyring::Entry::new(SERVICE, &name).map_err(sanitize_error)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(sanitize_error(e)),
    }
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    validate_secret_command_name(&name)?;
    let entry = keyring::Entry::new(SERVICE, &name).map_err(sanitize_error)?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(sanitize_error(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_command_validation_rejects_bad_names_without_keychain_access() {
        for name in ["../OPENAI_API_KEY", "BAD KEY", "TOKEN;rm", "x"] {
            assert!(validate_secret_command_name(name).is_err());
        }
    }

    #[test]
    fn secret_command_validation_allows_env_style_names() {
        assert!(validate_secret_command_name("GEMINI_API_KEY").is_ok());
        assert!(validate_secret_command_name("CUSTOM_API_KEY").is_ok());
    }
}
