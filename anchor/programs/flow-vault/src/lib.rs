use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("GACf7MzzDobMqJgDGfnaDJe7nCj5UoBoh93xLziomEoX");

#[program]
pub mod flow_vault {
    use super::*;

    pub fn create_vault(ctx: Context<CreateVault>, deposit_amount: u64) -> Result<()> {
        create_vault::handler(ctx, deposit_amount)
    }

    pub fn settle_batch(ctx: Context<SettleBatch>, amount: u64, nonce: u64) -> Result<()> {
        settle_batch::handler(ctx, amount, nonce)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        withdraw::handler(ctx)
    }
}