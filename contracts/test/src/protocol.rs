use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[program]
pub mod your_protocol {
    use super::*;

    pub fn add_project(ctx: Context<AddProject>, ipfs_hash: String, initial_deposit: u64, is_implicit: bool, initial_testcases: String, reward_splitting_spec: String, project_name: String) -> Result<()> {
        let project_info = &mut ctx.accounts.project_info;
        Ok(())
    }

    pub fn update_reward_spec(ctx: Context<UpdateRewardSpec>, reward_splitting_spec: String) -> Result<()> {
        let project_info = &mut ctx.accounts.project_info;
        require!(project_info.owner == ctx.accounts.owner.key(), ErrorCode::Unauthorized);
        project_info.reward_splitting_spec = reward_splitting_spec;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let staker_info = &mut ctx.accounts.staker_info;
        Ok(())
    }

}

#[derive(Accounts)]
pub struct AddProject<'info> {
    #[account(init, payer = user, space = ProjectInfo::LEN)]
    pub project_info: Account<'info, ProjectInfo>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRewardSpec<'info> {
    #[account(mut)]
    pub project_info: Account<'info, ProjectInfo>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker_info: Account<'info, StakerInfo>,
    pub user: Signer<'info>,
}

#[account]
pub struct ProjectInfo {
    ipfs_hash: String,
    reward: u64,
    base_reward: u64,
    is_implicit: bool,
    owner: Pubkey,
    status: ProjectStatus,
    project_name: String,
}



#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum ProjectStatus {
    Normal,
    Destroyed,
}

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
}

