#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    Address, BytesN, Env, String,
};

fn deploy_wallet<'a>(
    env: &'a Env,
    owner: &BytesN<32>,
    recovery: &Address,
) -> (Address, PocketletWalletClient<'a>) {
    let id = env.register(PocketletWallet, (owner.clone(), recovery.clone()));
    let client = PocketletWalletClient::new(env, &id);
    (id, client)
}

fn deploy_token<'a>(
    env: &'a Env,
    admin: &'a Address,
    name: &'a str,
    symbol: &'a str,
) -> (Address, mock_token::MockTokenClient<'a>) {
    let id = env.register(
        mock_token::MockToken,
        (
            admin.clone(),
            String::from_str(env, name),
            String::from_str(env, symbol),
            7u32,
        ),
    );
    let client = mock_token::MockTokenClient::new(env, &id);
    (id, client)
}

fn deploy_dex<'a>(env: &'a Env) -> (Address, mock_dex::MockDexClient<'a>) {
    let id = env.register(mock_dex::MockDex, ());
    let client = mock_dex::MockDexClient::new(env, &id);
    (id, client)
}

#[test]
fn test_constructor_sets_owner_and_recovery() {
    let env = Env::default();
    let owner = BytesN::random(&env);
    let recovery = Address::generate(&env);
    let (_, client) = deploy_wallet(&env, &owner, &recovery);

    assert_eq!(client.owner(), Some(owner));
    assert_eq!(client.recovery_admin(), Some(recovery));
}

#[test]
fn test_transfer_moves_tokens() {
    let env = Env::default();
    env.mock_all_auths();

    let platform = Address::generate(&env);
    let owner = BytesN::random(&env);
    let (_, wallet) = deploy_wallet(&env, &owner, &platform);

    let (token_id, token) = deploy_token(&env, &platform, "USDC", "USDC");
    token.mint(&wallet.address, &1000i128);

    let recipient = Address::generate(&env);
    wallet.transfer(&token_id, &recipient, &300i128);

    assert_eq!(token.balance(&wallet.address), 700);
    assert_eq!(token.balance(&recipient), 300);
}

#[test]
fn test_transfer_without_auth_fails() {
    let env = Env::default();
    // Do not mock auths; the contract should reject the unauthorized transfer.

    let platform = Address::generate(&env);
    let owner = BytesN::random(&env);
    let (_, wallet) = deploy_wallet(&env, &owner, &platform);

    let (token_id, _) = deploy_token(&env, &platform, "USDC", "USDC");

    let recipient = Address::generate(&env);
    let result = wallet.try_transfer(&token_id, &recipient, &300i128);
    assert!(result.is_err(), "transfer without authorization must fail");
}

#[test]
fn test_swap_via_mock_dex() {
    let env = Env::default();
    env.mock_all_auths();

    let platform = Address::generate(&env);
    let owner = BytesN::random(&env);
    let (_, wallet) = deploy_wallet(&env, &owner, &platform);

    let (usdc_id, usdc) = deploy_token(&env, &platform, "USDC", "USDC");
    let (xlm_id, xlm) = deploy_token(&env, &platform, "XLM", "XLM");
    let (dex_id, _) = deploy_dex(&env);

    usdc.mint(&wallet.address, &500i128);
    xlm.mint(&dex_id, &500i128);

    let bought = wallet.swap(&usdc_id, &xlm_id, &100i128, &100i128, &dex_id);
    assert_eq!(bought, 100);
    assert_eq!(usdc.balance(&wallet.address), 400);
    assert_eq!(xlm.balance(&wallet.address), 100);
    assert_eq!(xlm.balance(&dex_id), 400);
}

#[test]
fn test_recovery_admin_rotates_owner() {
    let env = Env::default();
    env.mock_all_auths();

    let platform = Address::generate(&env);
    let owner = BytesN::random(&env);
    let (_, wallet) = deploy_wallet(&env, &owner, &platform);

    let new_owner = BytesN::random(&env);
    wallet.rotate_owner(&new_owner);
    assert_eq!(wallet.owner(), Some(new_owner));
}
