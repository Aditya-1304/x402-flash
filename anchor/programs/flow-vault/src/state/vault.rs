use anchor_lang::prelude::*;

#[account]
pub struct Vault {

    pub agent: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub deposit_amount: u64,
    pub total_settled: u64,
    pub last_settlement_slot: u64,
    pub nonce: u64,
    pub reserved: [u8; 64],
}

impl Default for Vault {
    fn default() -> Self {
        Self {
            agent: Pubkey::default(),
            token_mint: Pubkey::default(),
            vault_token_account: Pubkey::default(),
            deposit_amount: 0,
            total_settled: 0,
            last_settlement_slot: 0,
            nonce: 0,
            reserved: [0u8; 64],
        }
    }
}

impl Vault {
    // discriminator + agent + token_mint + vault_token_account + deposit_amount + total_settled + last_settlement_slot + nonce + reserved
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 64;
}