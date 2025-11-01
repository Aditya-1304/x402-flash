use anchor_lang::prelude::*;

#[account]
pub struct Provider {
  pub authority: Pubkey,
  pub destination: Pubkey,
  pub reserved: [u8; 128],

}

impl Default for Provider {
  fn default() -> Self {
    Self {
      authority: Pubkey::default(),
      destination: Pubkey::default(),
      reserved: [0u8; 128],
    }
  }
}

impl Provider {
    // discriminator + authority + destination + reserved
    pub const LEN: usize = 8 + 32 + 32 + 128;
}