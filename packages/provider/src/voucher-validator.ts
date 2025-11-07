import { Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

export class VoucherValidator {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl);
  }

  async validateVault(vaultPubkey: string): Promise<boolean> {
    try {
      const pubkey = new PublicKey(vaultPubkey);
      const accountInfo = await this.connection.getAccountInfo(pubkey);


      return accountInfo !== null;
    } catch (error) {
      console.error('[VoucherValidator] Error validating vault:', error);
      return false;
    }
  }

  async verifyVoucher(voucher: any, signature: string): Promise<boolean> {
    try {

      const message = this.serializeVoucher(voucher);

      const signatureBytes = Buffer.from(signature, 'base64');
      const messageBytes = Buffer.from(message);
      const pubkeyBytes = new PublicKey(voucher.agentPubkey).toBytes();

      return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
    } catch (error) {
      console.error('[VoucherValidator] Error verifying voucher:', error);
      return false;
    }
  }

  private serializeVoucher(voucher: any): string {
    return JSON.stringify({
      vault: voucher.vaultPubkey,
      provider: voucher.providerPubkey,
      amount: voucher.amount,
      nonce: voucher.nonce,
      chainId: voucher.chainId || 'devnet'
    });
  }
}