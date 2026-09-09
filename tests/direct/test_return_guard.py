import hashlib
import json

import pytest


SDK_VERSION = "v0.2.16"
POLICY = "Unused products may be returned within 14 days."
ONE_GEN = 10**18


def address_text(address):
    return "0x" + bytes(address).hex()


def publish_policy(contract, policy=POLICY):
    contract.publish_policy(policy)
    return hashlib.sha256(policy.encode("utf-8")).hexdigest()


def open_case(contract, direct_vm, merchant, customer, case_id="RG-1001"):
    direct_vm.sender = merchant
    policy_hash = publish_policy(contract)
    direct_vm.value = ONE_GEN
    contract.submit_case(
        case_id,
        "electronics",
        policy_hash,
        address_text(customer),
        "The merchant says the activation log shows six hours of use.",
        "A timestamped activation log and packaging photos were submitted.",
    )
    direct_vm.value = 0
    return policy_hash


def accept_case(contract, direct_vm, customer, case_id="RG-1001"):
    direct_vm.sender = customer
    contract.accept_case(
        case_id,
        "The customer says the device was only opened for inspection.",
        "The customer supplied delivery photos.",
    )


def test_case_binds_separate_parties_and_escrow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    policy_hash = open_case(contract, direct_vm, direct_alice, direct_bob)

    assert contract.case_exists("RG-1001") is True
    assert contract.get_case_status("RG-1001") == "AWAITING_CUSTOMER"
    assert contract.get_escrow_amount("RG-1001") == ONE_GEN
    case = json.loads(contract.get_case("RG-1001"))
    assert case["policy_hash"] == policy_hash
    assert case["merchant"].lower() == address_text(direct_alice).lower()
    assert case["customer"].lower() == address_text(direct_bob).lower()
    assert case["customer_claim"] == ""

    accept_case(contract, direct_vm, direct_bob)
    assert contract.get_case_status("RG-1001") == "READY"
    assert "opened for inspection" in json.loads(contract.get_case("RG-1001"))["customer_claim"]


def test_only_policy_publisher_can_open_case(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    policy_hash = publish_policy(contract)

    direct_vm.sender = direct_charlie
    direct_vm.value = ONE_GEN
    with pytest.raises(Exception, match="merchant must publish this policy"):
        contract.submit_case(
            "RG-IMPOSTOR",
            "electronics",
            policy_hash,
            address_text(direct_bob),
            "A merchant response.",
            "Merchant evidence.",
        )


def test_customer_identity_is_enforced(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    open_case(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="only the bound customer"):
        contract.accept_case("RG-1001", "Forged claim", "Forged evidence")


def test_zero_value_case_is_rejected(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    policy_hash = publish_policy(contract)

    with pytest.raises(Exception, match="funded with GEN escrow"):
        contract.submit_case(
            "RG-NO-FUNDS",
            "electronics",
            policy_hash,
            address_text(direct_bob),
            "A merchant response.",
            "Merchant evidence.",
        )


def test_outsider_cannot_adjudicate(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    open_case(contract, direct_vm, direct_alice, direct_bob)
    accept_case(contract, direct_vm, direct_bob)

    direct_vm.sender = direct_charlie
    with pytest.raises(Exception, match="only the bound merchant or customer"):
        contract.adjudicate("RG-1001")


def test_unaccepted_case_can_only_be_cancelled_by_merchant(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    open_case(contract, direct_vm, direct_alice, direct_bob)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="only the bound merchant"):
        contract.cancel_unaccepted_case("RG-1001")

    direct_vm.sender = direct_alice
    contract.cancel_unaccepted_case("RG-1001")
    assert contract.get_case_status("RG-1001") == "CANCELLED"
    assert contract.get_escrow_amount("RG-1001") == 0


def test_adjudication_releases_escrow_and_cannot_be_retried(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    open_case(contract, direct_vm, direct_alice, direct_bob)
    accept_case(contract, direct_vm, direct_bob)
    direct_vm.mock_llm(
        ".*",
        json.dumps(
            {
                "decision": "REFUND_APPROVED",
                "policy_test": "COMPLIANT",
                "confidence": 90,
                "rationale": "The facts satisfy the policy. The customer is eligible for a refund.",
                "key_fact": "The product remained unused.",
            }
        ),
    )

    direct_vm.sender = direct_bob
    contract.adjudicate("RG-1001")
    decision = json.loads(contract.get_decision("RG-1001"))
    assert decision["decision"] == "REFUND_APPROVED"
    assert decision["settlement"] == "CUSTOMER"
    assert contract.get_case_status("RG-1001") == "SETTLEMENT_QUEUED"
    assert contract.get_escrow_amount("RG-1001") == 0

    with pytest.raises(Exception, match="case already adjudicated"):
        contract.adjudicate("RG-1001")


def test_policy_commitment_is_per_merchant(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    policy_hash = publish_policy(contract)

    assert contract.policy_exists(policy_hash) is True
    assert contract.policy_exists_for(address_text(direct_alice), policy_hash) is True
    assert contract.policy_exists_for(address_text(direct_bob), policy_hash) is False

    direct_vm.sender = direct_bob
    publish_policy(contract)
    assert contract.policy_exists_for(address_text(direct_bob), policy_hash) is True


def test_multiple_cases_are_kept_independently(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    open_case(contract, direct_vm, direct_alice, direct_bob, "RG-2001")
    open_case(contract, direct_vm, direct_alice, direct_charlie, "RG-2002")

    assert "RG-2001" in contract.get_case("RG-2001")
    assert "RG-2002" in contract.get_case("RG-2002")
    assert contract.get_escrow_amount("RG-2001") == ONE_GEN
    assert contract.get_escrow_amount("RG-2002") == ONE_GEN
