use anyhow::{bail, Context, Error, Result};

use clap::Subcommand;
use fehler::throws;
use gecko_client::Commander;

#[derive(Subcommand)]
#[allow(non_camel_case_types)]
pub enum FuzzCommand {
    /// Run fuzz target
    Run {
        /// Name of the fuzz target
        target: String,
    },
    /// Debug fuzz target with crash file
    Run_Debug {
        /// Name of the fuzz target
        target: String,
        /// Path to the crash file
        crash_file_path: String,
    },
}

#[throws]
pub async fn fuzz(root: Option<String>, subcmd: FuzzCommand) {
    let root = match root {
        Some(r) => r,
        _ => {
            let root = _discover()?;
            if let Some(r) = root {
                r
            } else {
                bail!("It does not seem that gecko is initialized because the gecko.toml file was not found in any parent directory!");
            }
        }
    };

    let commander = Commander::with_root(root);

    match subcmd {
        FuzzCommand::Run { target } => {
            commander.run_fuzzer(target).await?;
        }
        FuzzCommand::Run_Debug {
            target,
            crash_file_path,
        } => {
            commander.run_fuzzer_debug(target, crash_file_path).await?;
        }
    };
}

// Climbs each parent directory until we find gecko.toml.
fn _discover() -> Result<Option<String>> {
    let _cwd = std::env::current_dir()?;
    let mut cwd_opt = Some(_cwd.as_path());

    while let Some(cwd) = cwd_opt {
        for f in std::fs::read_dir(cwd)
            .with_context(|| format!("Error reading the directory with path: {}", cwd.display()))?
        {
            let p = f
                .with_context(|| {
                    format!("Error reading the directory with path: {}", cwd.display())
                })?
                .path();
            if let Some(filename) = p.file_name() {
                if filename.to_str() == Some("gecko.toml") {
                    return Ok(Some(cwd.to_string_lossy().to_string()));
                }
            }
        }

        cwd_opt = cwd.parent();
    }

    Ok(None)
}
