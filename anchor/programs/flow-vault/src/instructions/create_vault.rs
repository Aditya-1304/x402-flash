use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::Vault;
use crate::events::VaultCreated;

pub fn handler(ctx: Context<CreateVault>, deposit_amount: u64) -> Result<()> {
  let vault = &mut ctx.accounts.vault;

  vault.agent = ctx.accounts.agent.key();
  vault.token_mint = ctx.accounts.token_mint.key();
  vault.vault_token_account = ctx.accounts.vault_token_account.key();
  vault.deposit_amount = deposit_amount;
  vault.total_settled = 0;
  vault.last_settlement_slot = 0;
  vault.nonce = 0;

  let cpi_accounts = Transfer {
    from: ctx.accounts.agent_token_account.to_account_info(),
    to: ctx.accounts.vault_token_account.to_account_info(),
    authority: ctx.accounts.agent.to_account_info(),
  };
  let cpi_program = ctx.accounts.token_program.to_account_info();
  let cpi_ctx = CpiContext::new(cpi_program,cpi_accounts);
  token::transfer(cpi_ctx, deposit_amount)?;


  emit!(VaultCreated {
    vault: vault.key(),
    agent: vault.agent,
    token_mint: vault.token_mint,
    initial_deposit: deposit_amount,
  });
  Ok(())

}


#[derive(Accounts)]
pub struct CreateVault<'info> {
  #[account(mut)]
  pub agent: Signer<'info>,

  #[account(
    init, 
    payer = agent,
    space = Vault::LEN,
    seeds = [b"vault", agent.key().as_ref()],
    bump
  )]
  pub vault: Account<'info, Vault>,

  #[account(
    init, 
    payer = agent,
    token::mint = token_mint,
    token::authority = vault,
    seeds = [b"vault_token_account", agent.key().as_ref()],
    bump
  )]
  pub vault_token_account: Account<'info, TokenAccount>,

  #[account(
    mut, 
    constraint = agent_token_account.mint == token_mint.key()
  )]
  pub agent_token_account: Account<'info, TokenAccount>,

  pub token_mint: Account<'info, Mint>,
  pub token_program: Program<'info, Token>,
  pub system_program: Program<'info, System>,
}