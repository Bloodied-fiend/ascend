// Web Push sender. No dependencies: VAPID signing and aes128gcm payload encryption are done with
// node:crypto's WebCrypto, which keeps the deployed bundle a few KB like the rest of this function.
//
// Encrypted payloads (RFC 8291) rather than a bare tickle, because the notifications carry different
// text -- "Daily Quest not cleared" and "Agee passed you" cannot share one fixed string, and a
// payload-less push gives the service worker nothing to show.
//
// Specs: RFC 8030 (delivery), RFC 8291 (encryption), RFC 8292 (VAPID).
import { webcrypto as wc } from "node:crypto";

const enc = new TextEncoder();
const b64u = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const cat = (...a) => Buffer.concat(a.map(x => Buffer.from(x)));

// ---- VAPID: an ES256 JWT proving who is sending, signed with the private key we keep in env ----
async function vapidHeader(endpoint, publicKey, privateKey, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const pub = unb64u(publicKey);           // 65-byte uncompressed point: 0x04 || X(32) || Y(32)
  const jwk = { kty: "EC", crv: "P-256", d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), ext: true };
  const key = await wc.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await wc.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

// ---- HKDF, the one primitive both the key derivation and the content encryption need ----
async function hkdf(salt, ikm, info, len) {
  const base = await wc.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return Buffer.from(await wc.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, base, len * 8));
}

// ---- RFC 8291 ----
async function encrypt(payload, p256dh, auth) {
  const uaPub = unb64u(p256dh), authSecret = unb64u(auth);
  // an ephemeral keypair per message; its public half travels in the body so the UA can derive the same secret
  const as = await wc.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = Buffer.from(await wc.subtle.exportKey("raw", as.publicKey));
  const uaKey = await wc.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = Buffer.from(await wc.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  // the auth secret is the salt here; the info binds the derivation to BOTH public keys
  const keyInfo = cat(enc.encode("WebPush: info\0"), uaPub, asPub);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = Buffer.from(wc.getRandomValues(new Uint8Array(16)));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 marks the final record; everything is sent as a single record
  const plain = cat(enc.encode(payload), Buffer.from([2]));
  const aes = await wc.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = Buffer.from(await wc.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, plain));

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);      // record size
  return cat(salt, rs, Buffer.from([asPub.length]), asPub, ct); // header || ciphertext
}

/**
 * Send one notification. Returns the push service's HTTP status.
 * 404 or 410 means the subscription is dead and the caller should delete the row.
 */
export async function sendPush(sub, payload, { publicKey, privateKey, subject, ttl = 3600 }) {
  const body = await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
  const auth = await vapidHeader(sub.endpoint, publicKey, privateKey, subject);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { TTL: String(ttl), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length), Authorization: auth, Urgency: "normal" },
    body,
  });
  return r.status;
}

export const _test = { vapidHeader, encrypt, hkdf, b64u, unb64u };
