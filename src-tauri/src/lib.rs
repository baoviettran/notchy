#![allow(clippy::too_many_arguments, clippy::useless_format, clippy::unnecessary_sort_by, clippy::suspicious_open_options)]
// from_str: MetaKey::from_str is intentional, not std::str::FromStr
#![allow(clippy::should_implement_trait)]

pub mod database;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use database::commands::*;
use database::executor::DatabaseManager;
use database::connection::DatabasePaths;

/// Quick-capture window. `true` registers the global shortcut, the tray
/// "Quick Add" item, and tray-left-click capture. Set to `false` to disable
/// the feature entirely (the hidden window stays in the config, just
/// unreachable). Disabled 2026-08-19 per user request.
const QUICK_ADD_ENABLED: bool = false;

fn show_quick_add(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick-add") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            quit_app,
            // Lifecycle commands
            database_initialize,
            database_retry,
            database_status,
            database_restore,
            discover_restore_points,
            // Account commands
            account_list,
            account_get,
            account_get_balance,
            account_get_balance_as_of,
            account_create,
            account_update,
            account_delete,
            account_restore,
            // Transaction commands
            transaction_list,
            transaction_get,
            transaction_create,
            transaction_create_batch,
            transaction_update,
            transaction_delete,
            transaction_restore,
            transaction_duplicate,
            // Category commands
            category_list_buckets,
            category_create_bucket,
            category_rename_bucket,
            category_set_rollover_enabled,
            category_delete_bucket,
            category_list_tags,
            category_create_tag,
            category_rename_tag,
            category_move_tag,
            category_get_tag_transaction_info,
            category_delete_tag,
            // Budget commands
            budget_get_for_month,
            budget_get_spent_for_bucket,
            budget_get_rolled_over,
            budget_set_allocation,
            budget_copy_from_previous_month,
            budget_has_allocations,
            // Goal commands
            goal_list,
            goal_get,
            goal_create,
            goal_update,
            goal_delete,
            // Rule commands
            rule_list,
            rule_list_all,
            rule_create,
            rule_update,
            rule_delete,
            rule_upsert_learned,
            // Meta commands
            meta_get,
            meta_set,
            meta_delete,
            meta_is_first_run_complete,
            meta_get_locale,
            meta_get_currency,
            meta_is_tour_complete,
            meta_set_tour_complete,
            meta_set_first_run_complete,
            meta_get_default_quick_account,
            meta_set_default_quick_account,
            meta_clear_default_quick_account,
            // Debt commands
            debt_list,
            debt_write_off,
            // Reconciliation commands
            reconciliation_get_history,
            reconciliation_reconcile,
            // Report commands
            report_get_overview,
            report_get_trend,
            report_get_comparison,
            report_get_category_trend,
            report_get_stacked_category_series,
            report_get_year_over_year,
            report_get_net_worth_series,
        ])
        .plugin({
            let mut builder = tauri_plugin_global_shortcut::Builder::new();
            if QUICK_ADD_ENABLED {
                builder = builder
                    .with_shortcut("CmdOrCtrl+Shift+N")
                    .unwrap()
                    .with_handler(|app, _shortcut, event| {
                        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            show_quick_add(app);
                        }
                    });
            }
            builder.build()
        })
        .setup(|app| {
            // Spawn the database manager early so the IPC handler can resolve it.
            let data_dir = app.path().app_data_dir().expect("failed to resolve app data dir");
            let config_dir = app.path().app_config_dir().expect("failed to resolve app config dir");
            let paths = DatabasePaths::new(config_dir, data_dir);
            let manager = DatabaseManager::spawn(paths, 64)
                .expect("failed to spawn database manager");
            app.manage(manager);

            let show = MenuItem::with_id(app, "show", "Show Notchy", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = if QUICK_ADD_ENABLED {
                let quick_add = MenuItem::with_id(app, "quick_add", "Quick Add", true, None::<&str>)?;
                Menu::with_items(app, &[&quick_add, &show, &quit])?
            } else {
                Menu::with_items(app, &[&show, &quit])?
            };

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quick_add" => show_quick_add(app),
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if QUICK_ADD_ENABLED {
                            show_quick_add(tray.app_handle());
                        } else {
                            show_main(tray.app_handle());
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
