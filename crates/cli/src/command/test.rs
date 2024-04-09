use anyhow::Error;
use fehler::throws;
use gecko_client::*;

#[throws]
pub async fn test(root: String) {
    let commander = Commander::with_root(root);
    commander.run_tests().await?;
}
