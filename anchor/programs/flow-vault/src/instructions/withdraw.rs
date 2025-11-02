use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};
use crate::state::Vault;
use crate::events::Withdrawn;

pub fn handler(ctx: Context<Withdraw>) -> Result<()>{
  let vault = &ctx.accounts.vault;
  let remaining_amount = ctx.accounts.vault_token_account.amount;

  if remaining_amount > 0 {
    let seeds = &[
      b"vault",
      vault.agent.as_ref(),
      &[ctx.bumps.vault],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
      from: ctx.accounts.vault_token_account.to_account_info(),
      to: ctx.accounts.agent_token_account.to_account_info(),
      authority: vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, remaining_amount)?;
  }

  let seeds = &[
    b"vault",
    vault.agent.as_ref(),
    &[ctx.bumps.vault],
  ];

  let signer_seeds = &[&seeds[..]];
  let cpi_accounts = CloseAccount {
    account: ctx.accounts.vault_token_account.to_account_info(),
    destination: ctx.accounts.agent.to_account_info(),
    authority: vault.to_account_info(),
  };
  let cpi_program = ctx.accounts.token_program.to_account_info();
  let cpi_ctx=  CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
  token::close_account(cpi_ctx)?;

  emit!(Withdrawn {
    vault: vault.key(),
    agent: vault.agent,
    amount: remaining_amount,
  });

  Ok(())

}

#[derive(Accounts)]
pub struct Withdraw<'info> {
  #[account(mut)]
  pub agent: Signer<'info>,

  #[account(
    mut,
    close = agent,
    seeds = [b"vault", agent.key().as_ref()],
    bump,
    has_one = agent
  )]
  pub vault: Account<'info, Vault>,

  #[account(
    mut,
    seeds = [b"vault_token_account", agent.key().as_ref()],
    bump,
    constraint = vault_token_account.key() == vault.vault_token_account
  )]
  pub vault_token_account: Account<'info, TokenAccount>,

  #[account(mut)]
  pub agent_token_account: Account<'info, TokenAccount>,

  pub token_program: Program<'info, Token>,
}