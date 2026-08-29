#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Bytes, BytesN, Env,
};

#[derive(Clone)]
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
