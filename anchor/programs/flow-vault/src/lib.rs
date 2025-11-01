use anchor_lang::prelude::*;
mod state;
mod instructions;
mod errors;
mod events;

declare_id!("GACf7MzzDobMqJgDGfnaDJe7nCj5UoBoh93xLziomEoX");

#[program]
pub mod flow_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
