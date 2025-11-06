use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::PaymentProtocol;

declare_id!("Ca5JKghY5ECswAfm3NkvxeEXFmCongnnfkvpFyr5Yirg");

#[program]
pub mod flow_vault {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        settle_threshold: u64,
        fee_bps: u16,
    ) -> Result<()> {
        init_config::handler(ctx, settle_threshold, fee_bps)
    }

    /// [BOUNTY] Updated function signature
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        visa_merchant_id: Option<String>,
        protocol: PaymentProtocol,
    ) -> Result<()> {
        register_provider::handler(ctx, visa_merchant_id, protocol)
    }

    pub fn create_vault(ctx: Context<CreateVault>, deposit_amount: u64) -> Result<()> {
        create_vault::handler(ctx, deposit_amount)
    }

    pub fn settle_batch(ctx: Context<SettleBatch>, amount: u64, nonce: u64) -> Result<()> {
        settle_batch::handler(ctx, amount, nonce)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        withdraw::handler(ctx)
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>, paused: bool) -> Result<()> {
        emergency_pause::handler(ctx, paused)
    }
}