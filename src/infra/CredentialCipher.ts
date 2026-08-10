import crypto from 'node:crypto';

const CIPHER_VERSION = 'v1';
const IV_BYTES = 12;

/** AES-GCM envelope for Rebecca credentials stored in PostgreSQL. */
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (!secret.trim()) throw new Error('PANEL_CREDENTIALS_KEY_MISSING');
    this.key = crypto
      .createHash('sha256')
      .update('RebeccaSellBot/rebecca-panel-credentials\0', 'utf8')
      .update(secret, 'utf8')
      .digest();
  }

  encrypt(value: string | undefined): string | null {
    if (!value) return null;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      CIPHER_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(envelope: string | null | undefined): string | undefined {
    if (!envelope) return undefined;
    const [version, ivRaw, tagRaw, ciphertextRaw, ...extra] = envelope.split(':');
    if (
      version !== CIPHER_VERSION ||
      !ivRaw ||
      !tagRaw ||
      ciphertextRaw === undefined ||
      extra.length > 0
    ) {
      throw new Error('PANEL_CREDENTIAL_ENVELOPE_INVALID');
    }
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivRaw, 'base64url')
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new Error('PANEL_CREDENTIAL_DECRYPT_FAILED', { cause: error });
    }
  }
}
