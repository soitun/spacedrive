---
index: 10
---

- [General](#general)
  - [Audits](#audits)
  - [Cryptographic hygiene](#cryptographic-hygiene)
    - [`zeroize`](#zeroize)
    - [`Protected` wrapper](#protected-wrapper)
  - [RNG](#rng)
  - [Envelope Encryption](#envelope-encryption)
  - [Performance considerations](#performance-considerations)
- [Encryption and Decryption](#encryption-and-decryption)
  - [Encryption Algorithms](#encryption-algorithms)
  - [Construction](#construction)
    - [Edge-cases](#edge-cases)
  - [AAD](#aad)
- [Key derivation and hashing](#key-derivation-and-hashing)
  - [Hashing Algorithms](#hashing-algorithms)
  - [Parameters](#parameters)
- [Key Manager](#key-manager)
  - [Internal Structure](#internal-structure)
  - [Types of keys](#types-of-keys)
    - [Root Key](#root-key)
    - [User Key](#user-key)
      - [Memory only](#memory-only)
    - [Secret Key](#secret-key)
    - [Stored Key](#stored-key)
  - [Unlocking](#unlocking)
  - [Mounting](#mounting)
  - [Integration with Encryption and Decryption](#integration-with-encryption-and-decryption)
  - [Content salts](#content-salts)
- [File Headers](#file-headers)
  - [Base Structures](#base-structures)
  - [Objects](#objects)
    - [Keyslot](#keyslot)
    - [Metadata](#metadata)
    - [Preview Media](#preview-media)
  - [Serialization and Deserialization](#serialization-and-deserialization)
- [Keyring](#keyring)
  - [Overview](#overview)
  - [Apple (MacOS and iOS)](#apple-macos-and-ios)
  - [Linux](#linux)

## General

### Audits

We currently do not have an official audit.

For encryption and hashing, we use crates provided by `RustCrypto` and many of them do have official audits. `RustCrypto` have a great reputation for their code quality, security and transparent attitude towards their libraries.

You may find the audits for the `chacha20poly1305` and `aes-gcm` crates that we use [here](https://research.nccgroup.com/wp-content/uploads/2020/02/NCC_Group_MobileCoin_RustCrypto_AESGCM_ChaCha20Poly1305_Implementation_Review_2020-02-12_v1.0.pdf).

### Cryptographic hygiene

#### `zeroize`

[`Zeroize`](https://github.com/RustCrypto/utils/tree/master/zeroize) is a Rust crate which allows us to securely erase values from memory, without Rust's compiler optimizing it away.

By overwriting memory with zeroes, we can be certain that our (possibly sensitive) data no longer remains in-memory, and we'll be protected from attacks relating to memory reading/dumping.

#### `Protected` wrapper

We use a `Protected` wrapper, which is a Rust `struct` with no external visibility.

This struct does not implement `Copy`, so things are not copied/duplicated all over the place in memory. We do derive `Clone`, but this is always explicit - things are relatively auditable this way.

To access the value stored within the `Protected` wrapper, it is required to call `.expose()`. Again, this makes things relatively auditable as we can see what's accessing `Protected` values, and ensure it is correct/justified usage.

Values that are `Protected` will not leak into debug logs, and `[REDACTED]` will be shown instead.

`Protected` values implement [zeroize](#zeroize)-on-drop, meaning once they go out of scope/are no longer required, they're securely erased from memory.

### RNG

We use [`ChaCha20Rng`](https://docs.rs/rand_chacha/latest/rand_chacha/struct.ChaCha20Rng.html) seeded from the system's entropy source for all purposes where random values are used. This includes, but is not limited to the generation of: salts, nonces, master keys, and secret keys.

### Envelope Encryption

For everything involving encryption, we make use of [envelope encryption](https://cloud.google.com/kms/docs/envelope-encryption).

Instead of encrypting data directly with a hashed user-supplied password (or other derived keys), such as `hunter2`, we use an entirely random 32-byte master key for encrypting the data itself.

This 32-byte master key is then encrypted with our derived or (hashed) user-supplied password. This is theoretically slower, but the performance impact is negligible and the benefits are more than worth it.

This has many benefits: we change the password without re-encrypting all of the data, we can be sure there's enough entropy for encryption to be worthwhile. We can also be sure that without the encrypted master key and nonce, it would be impossible for an attacker to gain access with modern-day systems.

Things get a little more complex when we factor in the [key manager](#key-manager), but this covers the basics.

### Performance considerations

While designing our cryptographic system, we needed something that was UX-friendly, fast and secure.

To help assist with this, we chose modest [parameters](#parameters), which offers levels for both everyday users, and the most security-conscious. We also designed the key manager with these requirements in mind, which is why we hash each `User` key once and use [key derivation](#key-derivation-and-hashing) to produce new, unique keys.

These architectural choices allow for near-immediate access to any piece of encrypted data, provided the key is mounted within the key manager beforehand.

## Encryption and Decryption

### Encryption Algorithms

We offer two encryption algorithms, `AES-256-GCM` and `XChaCha20-Poly1305`, with the latter being the default. Both of these are AEADs, and allow for authenticated encryption (with associated data). This means that if any of the ciphertext changes (e.g. via tampering), decryption will fail.

We selected `XChaCha20-Poly1305` as the default encryption algorithm due to its performance and benefits when compared to `AES-GCM`. `AES` uses an [`S-Box`](https://en.wikipedia.org/wiki/Rijndael_S-box), and these are [vulnerable to cache timing attacks](https://cr.yp.to/antiforgery/cachetiming-20050414.pdf) in cases where hardware acceleration is not present. `AES` also operates on 128-bit blocks, even with key sizes larger than 128 bits.

`XChaCha20-Poly1305` is fast, and a lot more secure on devices that do not have AES-NI or other hardware acceleration (that's not many devices these days, but still something to be wary of). Due to the increased nonce size (24 bytes, as opposed to 12), it can encrypt a **lot** more data with the same key before ever worrying about nonce-reuse.

At the end of the day, despite the shortcomings of `AES-GCM`, it's still one of the better AEADs out there (and it's FIPS-compliant).

### Construction

We make use of an `LE31` STREAM construction, provided by `RustCrypto`. This means we do not have to load an entire file into memory before encryption, and instead we can read `n` bytes at a time (in our case, `1MiB`). A block of the source file is read, encrypted, written - this repeats until we have reached the end of the file stream.

This results in a file size gain of 16 bytes per 1MiB, which can be calculated as follows (where `x` is equal to your file size in bytes):

$$ \Delta \text{(bytes)} = \lceil\frac{x}{1048576}\rceil \times 16 $$

STREAM requires a nonce size of `n - 4`, where `n` is the usual nonce size for your selected algorithm. This is because 3 bits are used as a counter, and the final bit designates whether or not the block you're encrypting is the last. More information can be found [here](https://docs.rs/aead/latest/aead/stream/struct.StreamLE31.html).

Using this construction, we are able to keep memory usage low and performance high. STREAM also protects us against reordering and truncation attacks, along with allowing us to encrypt more data before worrying about key exhaustion.

#### Edge-cases

While designing our construction, edge-cases regarding file sizes that are multiples of `1Mib` were tested. If a file is exactly `3MiB` (or any other multiple), it will be encrypted as though it contains 4x blocks. 3 of these blocks contained the actual data, and then 1 block was encrypted at the end with zero bytes.

This does result in an additional 16 bytes of file size gain (for the AEAD tag), but it's most definitely a fair trade-off (and one that will rarely happen).

### AAD

As we use AEADs for encryption, we are able to authenticate additional data along with our ciphertext. If this associated data is not present during decryption (in its original form), decryption will fail. This is great for tamper prevention.

We use the first 36 bytes of the [file header](#base-structures) as AAD - these bytes should never change over the lifespan of an encrypted file.

## Key derivation and hashing

### Hashing Algorithms

We offer two hashing algorithms within Spacedrive - `Argon2id` and `BLAKE3-Balloon`. Behind the scenes, we also utilize `BLAKE3-KDF`, but this is not user-facing.

`Argon2id` is the default hashing algorithm, due to its reputation and memory-hardness. A few attacks have been discovered on `Argon2i` in the past, relating to a low number of passes, but these do not extend to `Argon2id`. `Argon2id` also offers moderate protection against both side-channel and TMTO attacks, and is a great all-rounder for our application.

`BLAKE3-Balloon` is provided, as [it's recommended by NIST](https://pages.nist.gov/800-63-3/sp800-63b.html) for password hashing (along with PBKDF2). `BLAKE3` itself is an extremely fast hash function, but the `Balloon` algorithm makes it slow, and provably-memory hard.

`Argon2id` also uses considerably larger amounts of physical memory than `BLAKE3-Balloon`, even with increased parameters (but the actual hashing takes a similar amount of time regardless of the algorithm).

`BLAKE3-KDF` is used internally for key derivation, in cases where we already have a high-entropy key (e.g. from one of the other hash functions). We use `BLAKE3-KDF` for deriving unique keys from the key manager's [root key](#root-key), and deriving unique keys from [user keys](#user-key) in order to prevent key-reuse. Each different derivation purpose uses a different context string, and a unique 16 byte salt. More information on `BLAKE3`'s key derivation can be found [here](https://raw.githubusercontent.com/BLAKE3-team/BLAKE3-specs/master/blake3.pdf).

`BLAKE3-KDF` does not directly allow for us to use a salt, just a context string and key material. To fix this, each `derive` goes through our own function, which appends the salt onto the key material. This looks like:

$$ \text{KDF}(\text{KEY} + \text{SALT}, \text{CONTEXT}) $$

### Parameters

Along with these [hashing algorithms](#hashing-algorithms) we also provide 3 parameter "levels".

We offer `Standard` (the default), `Hardened` and `Paranoid`. As the name suggests, `Paranoid` is for the most security-conscious users. The higher the parameter level, the longer keys will take to hash (but the more resistant to brute-force attacks you are).

`Standard` aims to take roughly 1~ second to hash, regardless of the hashing algorithm.

The hashing parameters for `Argon2id` are as follows:

$$ \text{standard}(m = 131072, t = 8, p = 4) $$

$$ \text{hardened}(m = 262114, t = 8, p = 4) $$

$$ \text{paranoid}(m = 524288, t = 8, p = 4) $$

The hashing parameters for `BLAKE3-Balloon` are as follows:

$$ \text{standard}(s = 131072, t = 2, p = 1) $$

$$ \text{hardened}(s = 262114, t = 2, p = 1) $$

$$ \text{paranoid}(s = 524288, t = 2, p = 1) $$

## Key Manager

### Internal Structure

The key manager consists of a few internal components, that cannot be accessed directly. You must go through the associated functions to interface with the key manager, and this allows for us to implement strict access control and logging.

With this model, we will be able to tell users what their keys were accessed for and when they were accessed. There are many other benefits, such as keeping the code maintainable and auditable. All calls to access raw key material must go through `KeyManager::get_key()`, for example.

The key manager consists of:

- A `root_key`
- A `verification_key` (the encrypted root key, needs to be present in order to unlock the vault)
- A `keystore` (`DashMap<Uuid, StoredKey>`)
- A `keymount` (`DashMap<Uuid, MountedKey>`)
- A `default` key (`UUID`)
- A `mounting_queue` (`DashSet<Uuid>`)
- A `keyring` interface

The `root_key` and `keymount` contain sensitive, hashed/decrypted data (within in the [protected wrapper](#protected-wrapper)) - the rest of these values are not sensitive but direct access is still not provided. They do however need to be stored in-memory somewhere, otherwise the key manager would not be able to provide the UX it does.

The `keystore`, `keymount`, `verification_key` and `default` are seeded on app-load from the `Prisma` database.

The `keystore` should attempt to remain completely in-sync with `Prisma`, unless a key possesses a true `memory_only` attribute.

The key manager attempts to initialize a `keyring` interface on app load, but will fail silently if the required dependencies are not available. This is expected behavior, and users will be required to manually enter their [secret key](#secret-key).

The `mounting_queue` is automatically updated depending on what we're hashing, and it is in place to prevent DoS attacks due to our usage of memory-hard key derivation functions. We have a queue in the front-end also, but this externally-immutable Rust queue helps prevent against attacks from malicious clients.

`DashMap` and `DashSet` were chosen for this application due to their improved performance and access when compared to the standard library alternatives. The usage of our key manager became more fluent, and this is critical in allowing us to offer good security, with a minimal cost to convenience.

### Types of keys

#### Root Key

The `Root` key is the glue of the key manager, and all [user keys](#user-key) are encrypted with a key that was [derived](#key-derivation-and-hashing) from the `Root` key.

Stored keys can also have the type of `Root` key, and this means it's an encrypted root key (also known as a verification key). One of these verification keys needs to be decrypted in order to decrypt anything stored within the key manager.

#### User Key

A `User` key is a key used directly by the user to encrypt or decrypt files. A `User` key must be UTF-8 encoded, but has no length restrictions.

The `User` key is used to encrypt a file's master key, but only once a unique key has been [derived](#key-derivation-and-hashing). The salt from derivation is stored within one of the header's [keyslots](#keyslot), along with the master key that was encrypted with the derived user key. More information on this can be found in [envelope encryption](#envelope-encryption).

##### Memory only

`User` keys can be memory-only, and will be completely erased from memory once the app closes or they are deleted.

Users have the option of storing these within the key manager and our database permanently, but it is not a requirement for encryption nor decryption.

Password-based decryption will have to be used if the key was removed from memory entirely.

#### Secret Key

The secret key is an 18-byte, hex encoded string (arbitrarily separated with `-` every 6 characters) that is used in conjunction with your master password in order to protect your vault. A typical secret key can look like:

```
7A544B-644A55-737754-596C4E-446A724-64A3F6
```

The secret key is stored in [OS-controlled keyrings](#keyring) where possible, and is retrieved automatically when the user attempts to unlock their vault. If OS keyrings are not available for any reason, the user will have to manually enter their secret key.

Users will also have to manually enter their secret key in a few other cases: if it's a new device and they're unlocking the vault for the first time, if the secret key is present but not valid, and if the secret key is present, valid but still incorrect. The secret key will be updated in the keyring once a successful master password/secret key combination has been provided.

If any part of the secret key does not line up, it will be replaced with a "filler" secret key so we don't leak which part of the unlocking process was incorrect.

The secret key is excellent for security, as it acts as 2FA for your vault. If your master password is ever compromised (and an attacker has a copy of your vault), they'd still need to brute-force 18 completely random bytes - that's 256<sup>18</sup> total permutations. It's extremely impractical to even attempt this kind of attack, so your data is safe.

Secret keys are unique to each library and master password, but this is very likely to change in the future.

#### Stored Key

A stored key contains only information that is safe for at-rest storage. The data is fully encrypted and would be useless to an attacker without knowledge of your master password and secret key.

We use the stored key struct in order to easily keep track of keys, and sync them to our database when required.

### Unlocking

To unlock the vault, at least one [verification key](#root-key) must be present.

The user's master password, along with their [secret key](#secret-key) are hashed together with a selected [hashing algorithm](#hashing-algorithms).

If this hash digest is able to successfully decrypt the root key, the root key is stored internally and the vault is considered unlocked. However, if any aspect of this fails, the vault will not be unlocked as no subsequent data can be decrypted without the root key.

If any `StoredKey` contains a true `automount` attribute, it will be mounted once the key manager successfully unlocks. If multiple are present, they are **not** mounted simultaneously as just 12 keys could use up to 6GiB of memory.

### Mounting

To mount a key, we need to:

- Retrieve the key manager's `Root` key
- [Derive the decryption key](#key-derivation-and-hashing) using the salt (stored in the `StoredKey` struct)
- Decrypt the `User` key
- Hash the decrypted `User` key with the associated [content salt](#content-salts)
- Insert the hash digest into the `keymount`, along with the related `UUID`

### Integration with [Encryption and Decryption](#encryption-and-decryption)

During encryption, a [mounted key](#mounting) is retrieved from the key manager and used as the "base" key. A new key is then [derived](#key-derivation-and-hashing) from this "base" key and a completely random salt, using `BLAKE3-KDF`.

We then go on to use this derived key for encrypting our file's master key with [envelope encryption](#envelope-encryption), and storing this encrypted master key in one of the file's two keyslots.

### Content salts

Content salts are 16 bytes in length, and act as a semi-global salt for each `User` key. They're in place for while we hash `User` keys during [mounting](#mounting), and they aim to protect us from rainbow-table attacks and similar. They don't offer much protection in the grand scheme of things, but they allow for us to only ever need to hash a key once and derive the rest (which is amazing for UX).

Content salts (along with key derivation salts) are stored in file header's [keyslots](#keyslot) in order to be library-agnostic. Usually, if these key & content salt associations were lost, users would have no chance of decrypting their data (even with the correct key) - we're able to restore these associations by offering password-based decryption (which uses the content salt stored in the keyslot).

## File Headers

### Base Structures

The base header:

| Name           | Purpose                      | Size       |
| -------------- | ---------------------------- | ---------- |
| Magic Bytes    | To quickly identify the file | 7 bytes    |
| Header Version |                              | 2 bytes    |
| Algorithm      | Encryption Algorithm         | 2 bytes    |
| Nonce          | Nonce used for the data      | 8/20 bytes |
| Padding        | To reach a total of 36 bytes | 5/17 bytes |

The [keyslots](#keyslot) area (file headers can contain up to 2x keyslots, but any empty keyslot must be replaced with 112 empty bytes):

| Name              | Purpose                      | Size       |
| ----------------- | ---------------------------- | ---------- |
| Keyslot Version   |                              | 2 bytes    |
| Algorithm         | Encryption Algorithm         | 2 bytes    |
| Hashing Algorithm | Hashing Algorithm            | 2 bytes    |
| Salt              | Salt used for key derivation | 16 bytes   |
| Content salt      | Salt used for hashing        | 16 bytes   |
| Master Key        | (encrypted)                  | 48 bytes   |
| Nonce             | Nonce used for encrypting MK | 8/20 bytes |
| Padding           | To reach 112 total bytes     | 6/18 bytes |

The [metadata](#metadata) area (completely optional):

| Name             | Purpose                  | Size       |
| ---------------- | ------------------------ | ---------- |
| Metadata Version |                          | 2 bytes    |
| Algorithm        | Encryption Algorithm     | 2 bytes    |
| Nonce            | Used for the data        | 8/20 bytes |
| Padding          | To reach 28 bytes        | 4/16 bytes |
| Length           | Length of the MD (`u64`) | 8 bytes    |
| Metadata         | (encrypted)              | Varies     |

The [preview media](#preview-media) area (completely optional):

| Name        | Purpose                   | Size       |
| ----------- | ------------------------- | ---------- |
| PVM Version |                           | 2 bytes    |
| Algorithm   | Encryption Algorithm      | 2 bytes    |
| Nonce       | Used for the data         | 8/20 bytes |
| Padding     | To reach 28 bytes         | 4/16 bytes |
| Length      | Length of the PVM (`u64`) | 8 bytes    |
| Metadata    | (encrypted)               | Varies     |

### Objects

#### Keyslot

The hashing algorithm and content salt are inherited from the `User` key (from the key manager), and is just information about how the key should be dealt with in the event that the key is no longer present in the library.

The encryption algorithm of the key is the same used to encrypt the file.

#### Metadata

Metadata can be anything that implements `serde::Serialize` and `serde::Deserialize`, and in our case it's a custom `struct` with information regarding the file that was pulled from the library.

Our `Metadata` consists of:

- `path_id`
- `name`
- `hidden`
- `favorite`
- `important`
- `note`
- `date_created`
- `date_modified`

#### Preview Media

Preview media can technically be defined as any type, as long as it can be formatted as a `Vec<u8>`. There are no size restrictions, but it's best to keep it small as it's loaded into memory all at once.

We use the preview media header object to store the file's original preview media, so that we can:

1. Allow users to preview the contents of their encrypted files
2. Restore it on decryption so we don't have to re-generate it

### Serialization and Deserialization

We use custom serialize/deserialize functions, which can convert any header types into bytes and vice versa.

This approach was chosen, as opposed to something such as `serde_json`, so that we have complete control over the size, contents and ordering of file headers.

More information about the complete structure of file headers can be found [here](#base-structures).

## Keyring

### Overview

The `KeyringInterface` is used to interface with OS keyrings, no matter the target OS. It consists of a `Box<dyn Keyring + Send>` internally, and the inner value depends on the target OS.

Typical values for our keyring usage can be found below:

| Name        | Value                                  |
| ----------- | -------------------------------------- |
| Application | `Spacedrive`                           |
| Library     | `67283637-baf9-4fd4-ac28-0b97a8166514` |
| Usage       | `Secret key`                           |

### Apple (MacOS and iOS)

Our Apple keyring interface uses the `SecItem` [keychain](https://developer.apple.com/documentation/security/keychain_services) API via the [`security_framework`](https://crates.io/crates/security_framework) Rust crate.

We use the `generic_password` type, as we have no need for most of the values attached to `internet_password`.

The `account` value consists of `$library_uuid - $usage`.

The `service` value is the application name (in our case, `Spacedrive`).

### Linux

Our Linux keyring interface uses the `secret-service` API (via the [`secret-service`](https://crates.io/crates/secret-service) Rust crate) in order to securely store and retrieve secrets. This works great, but is not supported in 100% of cases - it strictly requires `DBus`, and either `gnome-keyring` or `kwallet`. Most major Linux distributions have these tools pre-installed.

The default collection is used, as the `secret-service` API seems occasionally lack support for custom collections.

The `label` value consists of `$application - $usage`.

The `attributes` attached are as follows:

| Name        | Value           |
| ----------- | --------------- |
| Application | `$application`  |
| Library     | `$library_uuid` |
| Usage       | `$usage`        |

In order to retrieve any key from the keyring successfully, all 3 of these attributes must match.
