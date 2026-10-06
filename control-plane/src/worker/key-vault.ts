import { DurableObject } from 'cloudflare:workers';
import { base64url, fromBase64url } from './crypto';
import type { Env } from './env';

/**
 * Holds the key that encrypts provider credentials in D1 (04). The key never leaves this
 * object: callers send plaintext or ciphertext and get the other back.
 */
export class KeyVault extends DurableObject<Env> {
  private async key(): Promise<{ id: string; key: CryptoKey }> {
    let stored = await this.ctx.storage.get<{ id: string; raw: string }>('key');
    if (!stored) {
      const raw = crypto.getRandomValues(new Uint8Array(32));
      stored = { id: `k${Date.now().toString(36)}`, raw: base64url(raw) };
      await this.ctx.storage.put('key', stored);
    }
    const key = await crypto.subtle.importKey('raw', fromBase64url(stored.raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { id: stored.id, key };
  }

  async encrypt(plaintext: string): Promise<{ keyId: string; ciphertext: string }> {
    const { id, key } = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    return { keyId: id, ciphertext: `${base64url(iv)}.${base64url(new Uint8Array(data))}` };
  }

  /** Returns null when the key is gone or different; the UI then asks for the credential again. */
  async decrypt(keyId: string, ciphertext: string): Promise<string | null> {
    const { id, key } = await this.key();
    if (id !== keyId) return null;
    const [iv, data] = ciphertext.split('.');
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, key, fromBase64url(data));
      return new TextDecoder().decode(plain);
    } catch {
      return null;
    }
  }
}

export const vault = (env: Env) => env.KEY_VAULT.get(env.KEY_VAULT.idFromName('vault'));
