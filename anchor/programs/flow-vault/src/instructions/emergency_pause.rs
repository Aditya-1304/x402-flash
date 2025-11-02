use anchor_lang::prelude::*;
use crate::state::GlobalConfig;

pub fn handler(_ctx: Context<EmergencyPause>, _paused: bool) -> Result<()> {
    msg!("Emergency pause triggered by admin");
    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump,
        has_one = admin
    )]
    pub global_config: Account<'info, GlobalConfig>,
}