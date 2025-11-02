use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PaymentProtocol {
  NativeSpl,
  AtxpBridge,
}

#[account]
pub struct Provider {
  pub authority: Pubkey,
  pub destination: Pubkey,

  /// [BOUNTY: Visa TAP]
  pub visa_merchant_id: Option<String>,

  /// [BOUNTY: ATXP]
  pub protocol: PaymentProtocol,

  pub reserved: [u8; 90],

}

impl Default for Provider {
  fn default() -> Self {
    Self {
      authority: Pubkey::default(),
      destination: Pubkey::default(),
      visa_merchant_id: None,
      protocol: PaymentProtocol::NativeSpl,
      reserved: [0u8; 90],
    }
  }
}

impl Provider {
    // discriminator + authority + destination + reserved
     pub const LEN: usize = 8 + 32 + 32 + (1 + 4 + 32) + 1 + 90;
}