use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    program_pack::{IsInitialized, Pack, Sealed},
    sysvar::{rent::Rent, Sysvar},
};

pub struct TokenState {
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub total_supply: u64,
}

impl Sealed for TokenState {}
impl IsInitialized for TokenState {
    fn is_initialized(&self) -> bool {
        self.is_initialized
    }
}
impl Pack for TokenState {
    const LEN: usize = 73; 

    fn unpack_from_slice(src: &[u8]) -> Result<Self, ProgramError> {
    }

    fn pack_into_slice(&self, dst: &mut [u8]) {
    }
}
pub enum TokenInstruction {
    InitializeAccount,
    Transfer { amount: u64 },
}

impl TokenInstruction {
    pub fn unpack(input: &[u8]) -> Result<Self, ProgramError> {
    }
}

entrypoint!(process_instruction);
pub fn process_instruction(
    program_id: &Pubkey, 
    accounts: &[AccountInfo], 
    instruction_data: &[u8]
) -> ProgramResult {
    let instruction = TokenInstruction::unpack(instruction_data)?;

    match instruction {
        TokenInstruction::InitializeAccount => {
            msg!("Instruction: InitializeAccount");
            process_initialize_account(accounts, program_id)
        },
        TokenInstruction::Transfer { amount } => {
            msg!("Instruction: Transfer");
            process_transfer(accounts, amount, program_id)
        },
    }
}


fn process_initialize_account(
    accounts: &[AccountInfo],
    program_id: &Pubkey,
) -> ProgramResult {

    Ok(())
}

fn process_transfer(
    accounts: &[AccountInfo],
    amount: u64,
    program_id: &Pubkey,
) -> ProgramResult {

    Ok(())
}


