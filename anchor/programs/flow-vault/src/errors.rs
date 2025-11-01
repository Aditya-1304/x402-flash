use anchor_lang::prelude::*;

#[error_code]
pub enum FlowError {
    #[msg("Insufficient funds in vault for settlement.")]
    InsufficientFunds,
    #[msg("Invalid signature provided for settlement.")]
    InvalidSignature,
    #[msg("Nonce has already been used or is invalid.")]
    InvalidNonce,
    #[msg("The provided amount for settlement is zero.")]
    ZeroAmount,
    #[msg("Arithmetic overflow occurred.")]
    Overflow,
}