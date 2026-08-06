#![no_std]
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short,
    token::TokenClient,
    Address, Bytes, BytesN, Env, IntoVal, Val, Vec,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    RecoveryAdmin,
}

/// Signature shape expected by the custom-account interface.
///
/// This matches the standard Soroban account-contract format produced by
/// `authorizeEntry` in the Stellar SDKs: a vector of Ed25519 public-key +
/// signature pairs. The wallet currently expects a single signature from the
/// stored owner key.
#[contracttype]
#[derive(Clone)]
pub struct AccSignature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum WalletError {
    NotInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    SwapFailed = 4,
    AlreadyInitialized = 5,
}

#[contract]
pub struct PocketletWallet;

#[contractimpl]
impl PocketletWallet {
    /// Runs once at deploy time. Stores the passkey-derived Ed25519 owner
    /// pubkey and a platform-controlled recovery admin Address.
    pub fn __constructor(
        env: Env,
        owner_pubkey: BytesN<32>,
        recovery_admin: Address,
    ) -> Result<(), WalletError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(WalletError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Owner, &owner_pubkey);
        env.storage()
            .instance()
            .set(&DataKey::RecoveryAdmin, &recovery_admin);
        Ok(())
    }

    pub fn owner(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::Owner)
    }

    pub fn recovery_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::RecoveryAdmin)
    }

    /// Transfer `amount` of `token` from this wallet to `to`. Requires the
    /// wallet owner (or an authorized relayer) to authorize the call via the
    /// custom-account `__check_auth` interface.
    pub fn transfer(
        env: Env,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), WalletError> {
        if amount <= 0 {
            return Err(WalletError::InvalidAmount);
        }
        env.current_contract_address().require_auth();
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);
        Ok(())
    }

    /// Swap `sell_amount` of `sell_token` for at least `min_buy_amount` of
    /// `buy_token` by calling the configured DEX contract.
    pub fn swap(
        env: Env,
        sell_token: Address,
        buy_token: Address,
        sell_amount: i128,
        min_buy_amount: i128,
        dex: Address,
    ) -> Result<i128, WalletError> {
        if sell_amount <= 0 {
            return Err(WalletError::InvalidAmount);
        }
        env.current_contract_address().require_auth();

        let args: Vec<Val> = Vec::from_array(
            &env,
            [
                sell_token.into_val(&env),
                buy_token.into_val(&env),
                env.current_contract_address().into_val(&env),
                sell_amount.into_val(&env),
                min_buy_amount.into_val(&env),
            ],
        );
        let bought: i128 = env.invoke_contract(&dex, &symbol_short!("swap"), args);
        Ok(bought)
    }

    /// Rotate the owner public key. Only callable by the recovery admin.
    pub fn rotate_owner(env: Env, new_owner: BytesN<32>) -> Result<(), WalletError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::RecoveryAdmin)
            .ok_or(WalletError::NotInitialized)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::Owner, &new_owner);
        Ok(())
    }
}

#[contractimpl]
impl CustomAccountInterface for PocketletWallet {
    type Signature = Vec<AccSignature>;
    type Error = WalletError;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<AccSignature>,
        _auth_contexts: Vec<Context>,
    ) -> Result<(), WalletError> {
        let owner: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(WalletError::NotInitialized)?;

        if signatures.is_empty() {
            return Err(WalletError::Unauthorized);
        }

        // The wallet is single-signature: one entry signed by the owner.
        let sig = signatures.get(0).ok_or(WalletError::Unauthorized)?;
        if sig.public_key != owner {
            return Err(WalletError::Unauthorized);
        }

        let payload_bytes: Bytes = signature_payload.into();
        env.crypto()
            .ed25519_verify(&owner, &payload_bytes, &sig.signature);
        Ok(())
    }
}

mod test;
