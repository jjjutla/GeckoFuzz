use anyhow::Error;
use fehler::throws;
use gecko_client::TestGenerator;

#[throws]
pub async fn init(skip_fuzzer: bool) {
    let generator = TestGenerator::new();
    generator.generate(skip_fuzzer).await?;
}
