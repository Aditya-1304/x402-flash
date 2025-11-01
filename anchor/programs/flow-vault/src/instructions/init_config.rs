use anchor_lang::prelude::*;
use crate::state::GlobalConfig;


pub fn handler(
  ctx: Context<InitializeConfig>,
  settle_threshold: u64,
  fee_bps: u16,
) -> Result<()> {
  let config = &mut ctx.accounts.global_config;
  config.admin = ctx.accounts.admin.key();
  config.settle_threshold = settle_threshold;
  config.fee_bps = fee_bps;
  Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = GlobalConfig::LEN,
        seeds = [b"config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
}