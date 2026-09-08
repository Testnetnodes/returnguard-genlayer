import pytest
import hashlib
import json


SDK_VERSION = "v0.2.16"
POLICY = "Unused products may be returned within 14 days."


def publish_policy(contract, policy=POLICY):
    contract.publish_policy(policy)
    return hashlib.sha256(policy.encode("utf-8")).hexdigest()


def test_submit_and_read_case(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    policy_hash = publish_policy(contract)

    contract.submit_case(
        "RG-1001",
        "electronics",
        policy_hash,
        "The buyer says the device was only opened for inspection.",
        "The merchant says the device activation log shows six hours of use.",
        "A timestamped activation log and packaging photos were submitted.",
    )

    assert contract.case_exists("RG-1001") is True
    case = json.loads(contract.get_case("RG-1001"))
    assert case["case_id"] == "RG-1001"
    assert case["policy"] == POLICY
    assert case["policy_hash"] == policy_hash
    assert case["policy_published_at"]
    assert contract.get_decision("RG-1001") == ""


def test_policy_is_immutable_and_addressable_by_hash(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    policy_hash = publish_policy(contract)

    assert contract.policy_exists(policy_hash) is True
    assert contract.get_policy(policy_hash) == POLICY
    assert contract.get_policy_published_at(policy_hash)


def test_case_rejects_unpublished_policy(direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    unpublished_hash = hashlib.sha256(b"A policy invented after the dispute").hexdigest()

    with pytest.raises(Exception, match="policy must be published before the case"):
        contract.submit_case(
            "RG-UNPUBLISHED",
            "electronics",
            unpublished_hash,
            "The buyer requests a refund.",
            "The merchant rejects the request.",
            "Both parties submitted evidence.",
        )


def test_unknown_case(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)

    assert contract.case_exists("missing") is False
    assert contract.get_case("missing") == ""
    assert contract.get_decision("missing") == ""


def test_multiple_cases_are_kept_independently(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    electronics_policy = "Unused products may be returned within 14 days."
    apparel_policy = "Unworn items may be returned within 30 days."
    electronics_hash = publish_policy(contract, electronics_policy)
    apparel_hash = publish_policy(contract, apparel_policy)

    contract.submit_case(
        "RG-2001",
        "electronics",
        electronics_hash,
        "The buyer says the product was unused.",
        "The merchant says the seal was broken.",
        "Packaging photos were submitted.",
    )
    contract.submit_case(
        "RG-2002",
        "apparel",
        apparel_hash,
        "The buyer says the item was only tried on.",
        "The merchant says the tags were removed.",
        "The return inspection report was submitted.",
    )

    assert "RG-2001" in contract.get_case("RG-2001")
    assert "RG-2002" in contract.get_case("RG-2002")


def test_adjudicated_case_cannot_be_retried(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/return_guard.py", sdk_version=SDK_VERSION)
    policy_hash = publish_policy(contract)
    contract.submit_case(
        "RG-LOCKED",
        "electronics",
        policy_hash,
        "The buyer requests a refund.",
        "The merchant rejects the request.",
        "Both parties submitted evidence.",
    )
    contract.decisions["RG-LOCKED"] = '{"decision":"REFUND_REJECTED"}'

    with pytest.raises(Exception, match="case already adjudicated"):
        contract.adjudicate("RG-LOCKED")
