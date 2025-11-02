use anchor_lang::prelude::*;

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub agent: Pubkey,
    pub token_mint: Pubkey,
    pub initial_deposit: u64,
}

#[event]
pub struct Settlement {
    pub vault: Pubkey,
    pub provider: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub nonce: u64,

    /// [BOUNTY: Visa TAP]
    pub visa_merchant_id: Option<String>,
}

#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
}