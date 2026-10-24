// Round-trips the Web Push crypto without touching a push service.
//   node push_test.mjs
//
// This exists because a mistake in RFC 8291 fails SILENTLY: the push service still returns 201, the
// phone still wakes the service worker, and `e.data.json()` just throws into an empty catch. So rather
// than trusting the send path, this plays the role of the browser -- generates a subscriber keypair,
// encrypts to it, then derives the same secret from the other side and decrypts. If the plaintext
// comes back, the derivation, the HKDF info strings, the record padding and the AES-GCM framing are
// all right. It also verifies the VAPID JWT against its own public key.
import { webcrypto as wc } from "node:crypto";
import { _test } from "./push.mjs";

const { encrypt, vapidHeader, hkdf, b64u, unb64u } = _test;
const enc = new TextEncoder(), dec = new TextDecoder();
const res = [], check = (n, ok, info = "") => res.push(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + info}`);
const cat = (...a) => Buffer.concat(a.map(x => Buffer.from(x)));

// a stand-in for the browser's push subscription
const ua = await wc.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = Buffer.from(await wc.subtle.exportKey("raw", ua.publicKey));
const authSecret = Buffer.from(wc.getRandomValues(new Uint8Array(16)));

const payload = JSON.stringify({ title: "ASCEND", body: "Notifications are working.", tag: "test" });
const body = await encrypt(payload, b64u(uaPub), b64u(authSecret));

// header layout: salt(16) || rs(4) || idlen(1) || as_public(idlen) || ciphertext
const salt = body.subarray(0, 16);
const rs = body.readUInt32BE(16);
const idlen = body[20];
const asPub = body.subarray(21, 21 + idlen);
const ct = body.subarray(21 + idlen);
check("body carries a 16-byte salt, a record size and a 65-byte server key",
  salt.length === 16 && rs === 4096 && idlen === 65 && asPub.length === 65 && ct.length > 16,
  JSON.stringify({ rs, idlen, ctLen: ct.length }));

// now be the browser: same ECDH secret from the other direction
const asKey = await wc.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
const shared = Buffer.from(await wc.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
const ikm = await hkdf(authSecret, shared, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

let plain = null, threw = null;
try {
  const key = await wc.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  plain = Buffer.from(await wc.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct));
} catch (e) { threw = String(e && e.message || e); }
check("the subscriber can decrypt it (full RFC 8291 round trip)", !!plain, threw || "");
if (plain) {
  check("the final-record delimiter 0x02 is present", plain[plain.length - 1] === 2, String(plain[plain.length - 1]));
  const text = dec.decode(plain.subarray(0, plain.length - 1));
  check("the plaintext survives exactly", text === payload, text.slice(0, 80));
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  check("and parses as the JSON the service worker expects", !!parsed && parsed.title === "ASCEND", text.slice(0, 80));
}

// a different subscriber must NOT be able to read it -- proves the payload is actually bound to the key
{
  const other = await wc.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const sh2 = Buffer.from(await wc.subtle.deriveBits({ name: "ECDH", public: asKey }, other.privateKey, 256));
  const ikm2 = await hkdf(authSecret, sh2, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek2 = await hkdf(salt, ikm2, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const n2 = await hkdf(salt, ikm2, enc.encode("Content-Encoding: nonce\0"), 12);
  let leaked = false;
  try { const k = await wc.subtle.importKey("raw", cek2, "AES-GCM", false, ["decrypt"]);
    await wc.subtle.decrypt({ name: "AES-GCM", iv: n2, tagLength: 128 }, k, ct); leaked = true; } catch {}
  check("a different subscriber cannot decrypt it", !leaked);
}

// ---- VAPID ----
{
  const kp = await wc.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = Buffer.from(await wc.subtle.exportKey("raw", kp.publicKey));
  const jwk = await wc.subtle.exportKey("jwk", kp.privateKey);
  const hdr = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc", b64u(pub), jwk.d, "https://example.test/");
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(hdr);
  check("the Authorization header is a well-formed vapid t=/k= pair", !!m, hdr.slice(0, 60));
  if (m) {
    const [h, p, sig] = m[1].split(".");
    const claims = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    check("aud is the push service's ORIGIN, not the full endpoint",
      claims.aud === "https://fcm.googleapis.com", claims.aud);
    check("exp is in the future and inside the 24h the spec allows",
      claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400, String(claims.exp));
    const vk = await wc.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await wc.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, unb64u(sig), enc.encode(h + "." + p));
    check("the signature verifies against the advertised public key", ok);
    check("k= carries that same public key", m[2] === b64u(pub));
  }
}

console.log(res.join("\n"));
process.exit(res.some(r => r.startsWith("FAIL")) ? 1 : 0);
