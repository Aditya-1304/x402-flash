use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::state::{PaymentProtocol, Provider};

pub fn handler(ctx: Context<RegisterProvider>, visa_merchant_id: Option<String>, protocol: PaymentProtocol) -> Result<()> {
  let provider = &mut ctx.accounts.provider;
  provider.authority = ctx.accounts.authority.key();
  provider.destination = ctx.accounts.destination.key();
  provider.protocol = protocol;
  provider.visa_merchant_id = visa_merchant_id;
  Ok(())
}

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
  #[account(mut)]
  pub authority: Signer<'info>,

  #[account(
    init,
    payer = authority,
    space = Provider::LEN,
    seeds = [b"provider", authority.key().as_ref()],
    bump
  )]
  pub provider: Account<'info, Provider>,

  pub destination: Account<'info, TokenAccount>,

  pub system_program: Program<'info, System>,
}