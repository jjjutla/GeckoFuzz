use anyhow::Error;
use fehler::throws;

#[throws]
#[tokio::main]
async fn main() {
    gecko_cli::start().await?
}
