#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env,
};

#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub struct Deposit {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
    pub recipient_id_hash: BytesN<32>,
    pub expiry: u64,
    pub claimed: bool,
}

#[contracttype]
pub enum DataKey {
    Deposit(BytesN<32>),
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit tokens into escrow.
    ///
    /// * `sender` — the depositor (must authorize).
    /// * `token` — the SAC token contract (USDC or XLM).
    /// * `amount` — token amount in base units.
    /// * `claim_hash` — SHA-256 hash of the secret claim key.
    /// * `recipient_id_hash` — SHA-256 hash of the recipient's phone/email identifier.
    /// * `expiry` — ledger sequence at which the deposit becomes refundable.
    pub fn deposit(
        env: Env,
        sender: Address,
        token: Address,
        amount: i128,
        claim_hash: BytesN<32>,
        recipient_id_hash: BytesN<32>,
        expiry: u64,
    ) {
        sender.require_auth();

        assert!(
            !env.storage().persistent().has(&DataKey::Deposit(claim_hash.clone())),
            "Deposit with this claim_hash already exists"
        );
        assert!(amount > 0, "Amount must be positive");
        assert!(
            expiry > u64::from(env.ledger().sequence()),
            "Expiry must be in the future"
        );

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        let deposit = Deposit {
            sender,
            token,
            amount,
            recipient_id_hash,
            expiry,
            claimed: false,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Deposit(claim_hash.clone()), &deposit);

        env.events().publish(
            (symbol_short!("deposit"),),
            (
                claim_hash,
                deposit.sender,
                deposit.token,
                deposit.amount,
                deposit.recipient_id_hash,
                deposit.expiry,
            ),
        );
    }

    /// Claim a deposit by providing the secret.
    ///
    /// * `secret` — the plaintext secret whose SHA-256 hash matches the stored claim_hash.
    /// * `recipient_wallet` — the smart-wallet address that receives the funds.
    pub fn claim(env: Env, secret: BytesN<32>, recipient_wallet: Address) {
        let secret_bytes = Bytes::from_slice(&env, &secret.to_array());
        let computed_hash = env.crypto().sha256(&secret_bytes);
        let claim_hash: BytesN<32> = computed_hash.into();

        let key = DataKey::Deposit(claim_hash.clone());
        let mut deposit: Deposit = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Deposit not found");

        assert!(!deposit.claimed, "Deposit already claimed");
        assert!(
            u64::from(env.ledger().sequence()) <= deposit.expiry,
            "Deposit has expired"
        );

        let token_client = token::Client::new(&env, &deposit.token);
        token_client.transfer(
            &env.current_contract_address(),
            &recipient_wallet,
            &deposit.amount,
        );

        deposit.claimed = true;
        env.storage().persistent().set(&key, &deposit);

        env.events().publish(
            (symbol_short!("claim"),),
            (claim_hash, recipient_wallet, deposit.amount),
        );
    }

    /// Refund an expired deposit to the original sender.
    ///
    /// * `claim_hash` — the hash identifying the deposit.
    /// Only the original sender can call this, and only after expiry.
    pub fn refund(env: Env, claim_hash: BytesN<32>) {
        let key = DataKey::Deposit(claim_hash.clone());
        let deposit: Deposit = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Deposit not found");

        deposit.sender.require_auth();

        assert!(!deposit.claimed, "Deposit already claimed");
        assert!(
            u64::from(env.ledger().sequence()) > deposit.expiry,
            "Deposit has not expired yet"
        );

        let token_client = token::Client::new(&env, &deposit.token);
        token_client.transfer(
            &env.current_contract_address(),
            &deposit.sender,
            &deposit.amount,
        );

        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("refund"),),
            (claim_hash, deposit.sender, deposit.amount),
        );
    }

    /// Read a deposit's metadata without claiming or refunding.
    pub fn get_deposit(env: Env, claim_hash: BytesN<32>) -> Option<Deposit> {
        let key = DataKey::Deposit(claim_hash);
        env.storage().persistent().get(&key)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Address, Bytes, BytesN, Env};

    fn setup_env() -> Env {
        let env = Env::default();
        env.mock_all_auths();
        env
    }

    fn create_token(env: &Env, admin: &Address) -> Address {
        env.register_stellar_asset_contract(admin.clone())
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        let sac = token::StellarAssetClient::new(env, token);
        sac.mint(to, &amount);
    }

    fn compute_claim_hash(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
        let bytes = Bytes::from_slice(env, &secret.to_array());
        env.crypto().sha256(&bytes).into()
    }

    fn default_ledger_info() -> soroban_sdk::testutils::LedgerInfo {
        soroban_sdk::testutils::LedgerInfo {
            protocol_version: 20,
            sequence_number: 100,
            timestamp: 0,
            network_id: [0; 32],
            base_reserve: 10,
            min_temp_entry_ttl: 16,
            min_persistent_entry_ttl: 16,
            max_entry_ttl: 6312000,
        }
    }

    #[test]
    fn test_deposit_and_get_deposit() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[1u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[2u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        let deposit = client.get_deposit(&claim_hash).unwrap();
        assert_eq!(deposit.sender, sender);
        assert_eq!(deposit.token, token);
        assert_eq!(deposit.amount, 1000);
        assert_eq!(deposit.recipient_id_hash, recipient_id_hash);
        assert_eq!(deposit.expiry, expiry);
        assert!(!deposit.claimed);
    }

    #[test]
    #[should_panic]
    fn test_deposit_duplicate_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[1u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[2u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);
        client.deposit(&sender, &token, &500, &claim_hash, &recipient_id_hash, &(expiry + 1));
    }

    #[test]
    #[should_panic]
    fn test_deposit_zero_amount_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[1u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[2u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &0, &claim_hash, &recipient_id_hash, &expiry);
    }

    #[test]
    #[should_panic]
    fn test_deposit_expiry_not_future_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[1u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[2u8; 32]);
        let expiry = env.ledger().sequence() as u64;

        client.deposit(&sender, &token, &100, &claim_hash, &recipient_id_hash, &expiry);
    }

    #[test]
    fn test_claim_success() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let recipient_wallet = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[3u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[4u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&sender), 0);
        assert_eq!(token_client.balance(&contract_id), 1000);

        client.claim(&secret, &recipient_wallet);

        let deposit = client.get_deposit(&claim_hash).unwrap();
        assert!(deposit.claimed);
        assert_eq!(token_client.balance(&recipient_wallet), 1000);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    #[should_panic]
    fn test_claim_wrong_secret_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let recipient_wallet = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[5u8; 32]);
        let wrong_secret = BytesN::from_array(&env, &[6u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[7u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        client.claim(&wrong_secret, &recipient_wallet);
    }

    #[test]
    #[should_panic]
    fn test_claim_already_claimed_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let recipient_wallet = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[8u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[9u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 100;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        client.claim(&secret, &recipient_wallet);
        client.claim(&secret, &recipient_wallet);
    }

    #[test]
    #[should_panic]
    fn test_claim_expired_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let recipient_wallet = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[10u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[11u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 10;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        let mut info = env.ledger().get();
        info.sequence_number = 120; // past expiry (100 + 10)
        env.ledger().set(info);

        client.claim(&secret, &recipient_wallet);
    }

    #[test]
    fn test_refund_success() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[12u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[13u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 10;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        let mut info = env.ledger().get();
        info.sequence_number = 120; // past expiry
        env.ledger().set(info);

        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&sender), 0);

        client.refund(&claim_hash);

        assert_eq!(token_client.balance(&sender), 1000);
        assert_eq!(client.get_deposit(&claim_hash), None);
    }

    #[test]
    #[should_panic]
    fn test_refund_before_expiry_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[14u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[15u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 10;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        client.refund(&claim_hash);
    }

    #[test]
    #[should_panic]
    fn test_refund_already_claimed_fails() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let sender = Address::generate(&env);
        let recipient_wallet = Address::generate(&env);
        let admin = Address::generate(&env);
        let token = create_token(&env, &admin);
        mint(&env, &token, &sender, 1000);

        let secret = BytesN::from_array(&env, &[16u8; 32]);
        let claim_hash = compute_claim_hash(&env, &secret);
        let recipient_id_hash = BytesN::from_array(&env, &[17u8; 32]);
        let expiry = env.ledger().sequence() as u64 + 10;

        client.deposit(&sender, &token, &1000, &claim_hash, &recipient_id_hash, &expiry);

        client.claim(&secret, &recipient_wallet);

        let mut info = env.ledger().get();
        info.sequence_number = 120;
        env.ledger().set(info);

        client.refund(&claim_hash);
    }

    #[test]
    fn test_get_deposit_not_found() {
        let env = setup_env();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        let claim_hash = BytesN::from_array(&env, &[99u8; 32]);
        assert_eq!(client.get_deposit(&claim_hash), None);
    }
}
