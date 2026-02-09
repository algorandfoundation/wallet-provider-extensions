export type SecretType = "algo25" | "bip39" | "intermezzo" | "pera" | string; // Future examples could be Tokens for any service such as Algod/Indexer

/**
 * The state of the secret store.
 */
export interface SecretStoreState {
	secrets: Secret[];
	activeSecret: Secret | null;
}

/**
 * Represents a secret key object used for cryptographic operations.
 *
 * The Secret interface defines the structure of a secret object that includes metadata
 * and the actual cryptographic material. It supports different secret types, allowing
 * flexibility for various cryptographic standards or protocols.
 */
export interface Secret {
	/**
	 * A unique identifier represented as a string.
	 * This value is used to uniquely distinguish a secret.
	 */
	id: string;
	/**
	 *  A human-readable name or label associated with the secret key.
	 */
	name: string;
	/**
	 * The actual cryptographic material or secret managed (null when applicable, some secrets are non-exportable).
	 */
	value: string | null;
	/**
	 * Specifies the secret type, which determines the cryptographic standard or protocol
	 * this secret adheres to. Ecosystem accepted values are:
	 * - 'algo25': A secret based on the Algorand 25-word mnemonic standard.
	 * - 'bip39': A secret based on the BIP39 mnemonic standard.
	 * - 'intermezzo': A token used to communicate with Intermezzo vaults.
	 */
	type: SecretType;
	/**
	 * Additional metadata associated with the secret.
	 */
	metadata?: Record<string, any>;
}

/**
 * Represents a secure storage interface for managing cryptographic secrets.
 *
 * This interface serves as a contract for handling secrets in the form of `Secret` objects and
 * managing their lifecycle, as well as any associated extensions or plugins.
 *
 * Properties:
 * - `secrets`: An array of `Secret` objects, representing the collection of stored secrets.
 */
export interface SecretStoreExtension extends SecretStoreState {
	/**
	 * An object that represents additional functionality provided by this extension.
	 */
	secret: SecretStoreApi;
}

/**
 * Interface representing a SecretStore extension, which provides methods for key management
 * operations, including adding, removing, importing, and exporting secrets.
 */
export interface SecretStoreApi {
	/**
	 * Adds or registers the provided secret.
	 *
	 * @function
	 * @param {Secret} secret - The secret to add.
	 * @returns {Promise<Secret>} A promise that resolves the secret for chaining.
	 */
	add: (secret: Secret) => Promise<Secret>;
	/**
	 * Removes an item identified by the provided ID.
	 *
	 * @param {string} id - The unique identifier of the item to be removed.
	 * @return {Promise<void>} A promise that resolves when the removal is complete.
	 */
	remove: (id: string) => Promise<void>;

	/**
	 * Retrieves a secret by its unique identifier.
	 *
	 * @param {string} id - The unique identifier of the secret to retrieve.
	 * @returns {Promise<Secret | undefined>} A promise that resolves to the secret if found, or undefined if no matching secret is found.
	 */
	getById: (id: string) => Promise<Secret | undefined>;
}
