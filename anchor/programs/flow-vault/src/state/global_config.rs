use anchor_lang::prelude::*;
#[account]
pub struct GlobalConfig {

    pub admin: Pubkey,
    pub settle_threshold: u64,
    pub fee_bps: u16,
    pub reserved: [u8; 128],
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            admin: Pubkey::default(),
            settle_threshold: 0,
            fee_bps: 0,
            reserved: [0u8; 128],
        }
    }
}

impl GlobalConfig {
    pub const LEN: usize = 8 + 32 + 8 + 2 + 128;
}