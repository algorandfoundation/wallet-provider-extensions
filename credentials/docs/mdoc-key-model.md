# mDocs, the Keystore, and Self-Sovereign Identities

> **Status: architecture record (analysis only).** This note captures the strategic analysis of
> how mDocs — government IDs (e.g. mobile driving licences) from verified issuer lists — relate
> to the credential store, the keystore, and self-sovereign identities. No protocol
> implementation was commissioned; the open decisions at the end are recorded, not resolved.

## The three key hierarchies

Whenever an mDoc (ISO/IEC 18013-5 mobile document) exists, **three unrelated key hierarchies**
are in play. Most confusion about "how does an mDoc relate to our keys" comes from collapsing
them into one:

| Key                                                    | Controller                                                     | Location                                               | Role                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| IACA root → Document Signer                            | Issuer (government agency)                                     | Trust lists (IACA/VICAL — already handled by the team) | Signs the Mobile Security Object (MSO) → **authenticity**                                                                            |
| DeviceKey                                              | The **holding** wallet                                         | Holder's hardware keystore                             | Embedded in the issuer-signed MSO → **possession proof** at every presentation (`DeviceAuth` over a `SessionTranscript`, COSE_Sign1) |
| Wallet keystore keys (seed → ed25519/p256 → `did:key`) | The user, via the wallet ([`keystore` domain](../../keystore)) | `provider.key.store`                                   | **SSI holder binding** (`cnf` claim, KB-JWT via [`HolderBinding.getSigner`](../core/src/holder.ts))                                  |

For a **self-held mDoc** (the wallet itself was issued the document), the DeviceKey _is_ a
keystore key: the issuer signs over our p256 public key, and holder binding maps onto the
existing `HolderBinding` seam — just with COSE instead of JWS.

For an **OS-held mDoc** (e.g. Google Wallet's mDL), the DeviceKey lives in the OS wallet's
hardware keystore and never leaves it. The OS only exercises it inside its own presentation
ceremony. That single fact drives everything below.

## Why an OS-held mDoc cannot satisfy `HolderBinding.getSigner()`

[`HolderBinding.getSigner(address)`](../core/src/holder.ts) requires signing arbitrary
payloads with the holder's key. The OS will never do that with an mDoc's DeviceKey — it only
produces `DeviceAuth` signatures over a `SessionTranscript` it constructed itself. Therefore:

- An OS-held mDoc can at most be a **watch-only holder**. The seam already represents this:
  `HolderIdentity.sign` is optional, and `buildSignerFromHolder` returns `undefined` for
  holders that cannot sign. A watch-only holder can carry display claims and lineage metadata,
  but it cannot hold credentials that require presentations.
- The "mDoc-backed holder" language in `holder.ts` is only literally true (signer-capable)
  for **self-held** mDocs.

## `DeviceResponse` is evidence, not a credential

What [`DigitalCredentialsPlatform.get()`](../core/src/digital-credentials.ts)
(`provider.credential.digital.get()`) returns for an mDoc request is a **session-bound
`DeviceResponse`**: the verifier's nonce and origin are baked into the `SessionTranscript`
that `DeviceAuth` signs over. It is non-replayable and non-transferable _by design_.

- Storing it in the credential store works today (`format: "mso_mdoc"`,
  `raw: string | Uint8Array`) — but that record is an **archival evidence record**, never
  something the wallet can re-present.
- This is the key distinction from SD-JWT VCs, which are durable **and** re-presentable
  because _we_ hold the binding key.

**Bottom line:** there is no direct cryptographic relationship between an OS-held mDoc and the
wallet keystore. The relationship must be **constructed** — via one of the bridging patterns
below.

## The three bridging patterns

The patterns are complementary, not mutually exclusive: A gives durability, B gives privacy,
C gives freshness. A phased **C → A** rollout matches the "both roles, gated by feasibility"
stance.

### A. Identity proofing → derived SSI credential (the SSI-preserving pattern)

The wallet (or its backend) acts as _verifier_ of the mDoc **once**, then an issuer (e.g.
intermezzo) issues an SD-JWT VC whose `cnf` is one of our keystore-backed `did:key`s, with the
verified mDoc presentation recorded as `evidence`. The government identity becomes the
_provenance_ of a keystore-bound credential; everything downstream (presentation, cascade
eviction, `identityHolderBinding`) works unchanged.

> **Precedent:** [`identities-intermezzo-extension`](../../identities/intermezzo-extension)
> already implements credential-gated `did:algo` anchoring (`anchorIdentity`), where a
> device-attestation SD-JWT VC presentation gates a privileged operation. Pattern A is a
> direct generalization: "mDoc-gated" instead of "credential-gated".

- **Trade-offs:** durable and reusable; requires an issuing backend and mDoc verification
  (see feasibility below).

### B. Same-ceremony linking (no derived credential)

An OpenID4VP DCQL request can ask for **multiple credentials in one ceremony**: the OS-held
mDoc _and_ one of our SD-JWT VCs bound to our `did:key`. The verifier links the government
identity and our key within a single session transcript.

- **Trade-offs:** no storage, no derived artifact, maximum privacy — but the linkage is
  per-verifier and per-session, not reusable. Closest to working today: the web requester
  ([`credentials-web`](../web/src/platform.ts)) can already send DCQL queries.

### C. Live orchestration (mDoc as an on-demand identity source)

The wallet never stores anything mDoc-shaped. Whenever government identity is needed, it
triggers a fresh `digital.get()`. The result can be surfaced as a **watch-only identity
record** (`metadata.source: "digital-credentials"`, no `sign`) carrying display claims and a
pointer to how to re-request — the reserved "mDoc-backed identity source" slot in
[`identities/meta`](../../identities/meta) fits here.

- **Trade-offs:** always fresh, zero storage liability; every use requires a live platform
  ceremony and user interaction.

## Access feasibility (Android + web requester)

- **Web requester is real:** [`credentials/web/src/platform.ts`](../web/src/platform.ts)
  implements `navigator.credentials.get({ digital })` with feature detection. Desktop
  Chrome/Edge routes cross-device via the hybrid (QR/BLE) flow to Android wallets, where an
  OS-held mDL can appear in the chooser. Protocols in play: `openid4vp-v1-unsigned`,
  `openid4vp-v1-signed`, `org-iso-mdoc` (ISO 18013-7 Annex C).
- **The gating caveat is trust, not transport:** production government wallets generally
  answer only **signed OpenID4VP requests from registered verifiers** (reader certificates on
  the wallet's trust list). Accessing real mDLs is primarily a verifier-registration /
  trust-framework question — the mirror image of the issuer trust lists already handled.
- **RN in-app requester is an explicit stub:**
  [`reactNativeDigitalCredentials`](../react-native/src/platform.ts) rejects with
  `DigitalCredentialsUnsupportedError`. The needed bridge is Credential Manager's
  `GetDigitalCredentialOption` — the _inverse_ of the holder module already shipped in
  [`react-native-digital-credentials`](https://github.com/algorandfoundation/react-native-digital-credentials),
  so the native patterns (activity, broker, Expo module) are proven.
- **Post-access verification is the bigger gap than transport:** doing anything trustworthy
  with a returned `DeviceResponse` needs an mdoc codec — CBOR/COSE parsing, MSO validation
  against anchored IACA roots, and `SessionTranscript` reconstruction to check `DeviceAuth`.
  None of that exists in [`credentials/core/src/utils/`](../core/src/utils) (it is all JOSE).

## Open decisions (recorded, not resolved)

- **Verification locus for pattern A:** on-device mdoc codec (CBOR/COSE/MSO against anchored
  IACA roots) vs delegation to an intermezzo verifier endpoint. Affects whether
  `credentials-core` ever grows a COSE dependency.
- **Verifier registration strategy:** which wallet trust frameworks (Google Wallet reader
  certificates, jurisdiction VICALs) to register with, and whether the signed OpenID4VP
  request is produced client-side or by the backend.
- **Watch-only mDoc identity records:** whether pattern C's identity record lands as a new
  identities source bridge (per the reserved slot in `identities/meta`) or stays app-level.
- **RN requester bridge timing:** the `GetDigitalCredentialOption` Expo module is well-staged
  but deferred until a concrete consumer flow (A/B/C) is chosen.

These should be revisited when an implementation plan for any bridging pattern is
commissioned.
