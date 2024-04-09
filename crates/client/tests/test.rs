use anyhow::Error;
use fehler::throws;
use pretty_assertions::assert_str_eq;

#[throws]
#[tokio::test]
pub async fn generate_program_client() {
    // Generate with this command:
    // `gecko/examples/escrow/programs/escrow$ cargo expand > escrow_expanded.rs`
    // and the content copy to `test_data/expanded_anchor_program.rs`
    let expanded_anchor_program = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/test_data/expanded_anchor_program.rs"
    ));

    // You can copy the content from the `program_client` crate from an example
    // after you've called `makers gecko test`.
    let expected_client_code = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/test_data/expected_client_code.rs"
    ));

    let program_idl =
        gecko_client::idl::parse_to_idl_program("escrow".to_owned(), expanded_anchor_program)
            .await?;

    let idl = gecko_client::idl::Idl {
        programs: vec![program_idl],
    };

    let use_modules: Vec<syn::ItemUse> = vec![syn::parse_quote! { use gecko_client::*; }];
    let client_code =
        gecko_client::program_client_generator::generate_source_code(idl, &use_modules);
    let client_code = gecko_client::Commander::format_program_code(&client_code).await?;

    assert_str_eq!(client_code, expected_client_code);
}
