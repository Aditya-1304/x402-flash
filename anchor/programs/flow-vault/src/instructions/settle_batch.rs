use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use anchor_lang::solana_program::{
    sysvar::instructions::{self, load_instruction_at_checked},
};
use solana_program::ed25519_program;
use crate::state::{GlobalConfig, Provider, Vault};
use crate::errors::FlowError;
use crate::events::Settlement;

pub fn handler(ctx: Context<SettleBatch>, amount: u64, nonce: u64) -> Result<()> {
    // 1. Verify the ed25519 signature from the pre-instruction
    verify_signature(&ctx, amount, nonce)?;

    // 2. Business logic checks
    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;
    let config = &ctx.accounts.global_config;

    if amount < config.settle_threshold {
        return err!(FlowError::ZeroAmount);
    }
    if nonce != vault.nonce.checked_add(1).ok_or(FlowError::Overflow)? {
        return err!(FlowError::InvalidNonce);
    }
    let available_balance = vault.deposit_amount.checked_sub(vault.total_settled).ok_or(FlowError::Overflow)?;
    if available_balance < amount {
        return err!(FlowError::InsufficientFunds);
    }

    // 3. Perform the token transfer
    let seeds = &[
        b"vault",
        vault.agent.as_ref(),
        &[ctx.bumps.vault],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault_token_account.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer(cpi_ctx, amount)?;

    // 4. Update vault state
    vault.total_settled = vault.total_settled.checked_add(amount).ok_or(FlowError::Overflow)?;
    vault.nonce = nonce;
    vault.last_settlement_slot = clock.slot;

    // 5. Emit event
    emit!(Settlement {
        vault: vault.key(),
        provider: ctx.accounts.provider.key(),
        agent: vault.agent,
        amount,
        nonce,
        visa_merchant_id: ctx.accounts.provider.visa_merchant_id.clone(),
    });

    Ok(())
}

fn verify_signature(ctx: &Context<SettleBatch>, amount: u64, nonce: u64) -> Result<()> {
    let ix_sysvar = &ctx.accounts.instructions;
    let current_ix_index = instructions::load_current_index_checked(ix_sysvar)? as usize;

    // The ed25519 instruction must be the immediate preceding instruction
    if current_ix_index == 0 {
        return err!(FlowError::InvalidSignature);
    }
    let ed25519_ix_index = current_ix_index - 1;
    let ed25519_ix = load_instruction_at_checked(ed25519_ix_index, ix_sysvar)?;

    // Check that the instruction is for the ed25519 program
    if ed25519_ix.program_id != ed25519_program::ID {
        return err!(FlowError::InvalidSignature);
    }

    let signed_pubkey = &ed25519_ix.data[16..48];
    if signed_pubkey != ctx.accounts.agent.key.as_ref() {
        return err!(FlowError::InvalidSignature);
    }

    let message = &ed25519_ix.data[112..];
    let mut expected_message = Vec::new();
    expected_message.extend_from_slice(b"X402_FLOW_SETTLE");
    expected_message.extend_from_slice(&ctx.accounts.vault.key().to_bytes());
    expected_message.extend_from_slice(&ctx.accounts.provider.key().to_bytes());
    expected_message.extend_from_slice(&amount.to_le_bytes());
    expected_message.extend_from_slice(&nonce.to_le_bytes());

    if message != expected_message {
        return err!(FlowError::InvalidSignature);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SettleBatch<'info> {
    #[account(mut)]
    pub facilitator: Signer<'info>,

    /// CHECK: This is the agent's public key, not a signer.
    /// Its signature is checked against the ed25519 pre-instruction.
    pub agent: AccountInfo<'info>,

    #[account(
        mut,
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

    #[account(
      seeds = [b"config"],
      bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(has_one = destination)]
    pub provider: Account<'info, Provider>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,

    /// CHECK: The instructions sysvar is used to verify the ed25519 signature.
    #[account(address = instructions::ID)]
    pub instructions: AccountInfo<'info>,
}